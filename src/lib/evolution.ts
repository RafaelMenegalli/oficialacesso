/**
 * Evolution API v2 (self-hosted, Baileys / WHATSAPP-BAILEYS) helpers.
 * Verified against the evoapicloud/evolution-api v2.3.7 source:
 *   POST /instance/create                       global key
 *   GET  /instance/fetchInstances               global key
 *   GET  /instance/connect/{instance}           global key
 *   GET  /instance/connectionState/{instance}   global key
 *   POST /webhook/set/{instance}                global key
 *   POST /message/sendText/{instance}           instance token
 * Auth is a flat `apikey` header — never `Authorization: Bearer`.
 *
 * Relative imports with .ts extensions keep this file loadable by plain
 * `node` (scripts/evolution-setup.ts) as well as by Next.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv, getWhatsAppConfig } from "./env.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** Events this app consumes. Same list for instance creation and webhook/set. */
export const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "SEND_MESSAGE"] as const;

// ---------------------------------------------------------------------------
// Phone normalisation (Brazilian mobiles only)
// ---------------------------------------------------------------------------

/** Every DDD currently assigned by Anatel. */
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45,
  46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82,
  83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type PhoneError = "invalid_length" | "invalid_ddd" | "landline" | "missing_nine";

export type NormalizedPhone = { ok: true; e164: string } | { ok: false; error: PhoneError };

/** Portuguese, visitor-facing explanation for each rejection. */
export const PHONE_ERROR_MESSAGES: Record<PhoneError, string> = {
  invalid_length: "Número incompleto. Digite o DDD e o número do celular, ex.: (19) 98765-4321.",
  invalid_ddd: "Esse DDD não existe. Confira os dois primeiros dígitos do número.",
  landline: "Esse parece ser um telefone fixo. Informe um celular com WhatsApp.",
  missing_nine: "Faltou o 9 no início do celular. Ex.: (19) 98765-4321.",
};

/**
 * Normalises user input to E.164 ("+55" + DDD + 9 digits). Strips spaces,
 * parentheses, dashes, a leading "+55"/"55" and a leading trunk zero.
 */
export function normalizePhone(input: string): NormalizedPhone {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, ""); // trunk prefix, e.g. 019…
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);

  if (digits.length !== 10 && digits.length !== 11) return { ok: false, error: "invalid_length" };

  const ddd = Number(digits.slice(0, 2));
  if (!VALID_DDDS.has(ddd)) return { ok: false, error: "invalid_ddd" };

  const subscriber = digits.slice(2);
  if (subscriber.length === 8) {
    // 8 digits: landline (2–5) or a mobile typed without the leading 9 (6–9).
    return { ok: false, error: /^[2-5]/.test(subscriber) ? "landline" : "missing_nine" };
  }
  if (!subscriber.startsWith("9")) return { ok: false, error: "landline" };

  return { ok: true, e164: `+55${digits}` };
}

/**
 * Lead phones a WhatsApp JID may refer to. "5519981630656@s.whatsapp.net" →
 * "+5519981630656". WhatsApp often reports older Brazilian mobiles without
 * the 9th digit (55 DD XXXXXXXX), so both forms are returned.
 */
export function phoneCandidatesFromJid(jid: string): string[] {
  const digits = jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  if (!digits) return [];
  if (digits.startsWith("55") && digits.length === 12) {
    return [`+${digits}`, `+${digits.slice(0, 4)}9${digits.slice(4)}`];
  }
  return [`+${digits}`];
}

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** The one and only outbound message. First name + link; no phone, no ids. */
export function buildLeadMessage(firstName: string, vslUrl: string): string {
  return `Oii, ${firstName}! Tudo bem? 💛\nSegue o link para assistir ao vídeo completo:\n${vslUrl}`;
}

/**
 * Fallback when the send fails: a wa.me link that opens a chat with the
 * business, pre-filled with a greeting, so the lead is never stranded.
 */
export function buildWaLink(firstName: string): string {
  const { WHATSAPP_BUSINESS_PHONE } = getServerEnv();
  const greeting = `Oi! Meu nome é ${firstName} e quero receber o vídeo completo da Sensitiva.`;
  return `https://wa.me/${WHATSAPP_BUSINESS_PHONE}?text=${encodeURIComponent(greeting)}`;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface EvolutionConnection {
  baseUrl: string;
  /** Global key OR instance token — each call site says which. */
  apiKey: string;
}

/** Provider error reduced to status + short reason — never the whole payload. */
export interface EvolutionError {
  httpStatus: number;
  /** e.g. "not-on-whatsapp", "Connection Closed", "rate-overlimit", "timeout". */
  reason: string;
}

export class EvolutionRequestError extends Error {
  readonly error: EvolutionError;
  constructor(error: EvolutionError) {
    super(`Evolution API request failed: HTTP ${error.httpStatus} ${error.reason}`);
    this.error = error;
  }
}

/** Provider messages can echo the JID; mask any phone-length digit run. */
function maskDigits(text: string): string {
  return text.replace(/\d{8,}/g, (run) => `${run.slice(0, 4)}****${run.slice(-4)}`);
}

/**
 * v2 error envelope: { status, error, response: { message } } where message
 * is a string, a string[] or, for unknown numbers, [{ exists: false, jid }].
 */
function reasonFromBody(body: unknown, httpStatus: number): string {
  return maskDigits(rawReason(body, httpStatus));
}

function rawReason(body: unknown, httpStatus: number): string {
  if (!body || typeof body !== "object") return `http_${httpStatus}`;
  const record = body as Record<string, unknown>;
  const response = record.response as Record<string, unknown> | undefined;
  const message = response?.message ?? record.message;
  const items = Array.isArray(message) ? message : [message];
  for (const item of items) {
    if (item && typeof item === "object" && (item as Record<string, unknown>).exists === false) {
      return "not-on-whatsapp";
    }
    if (typeof item === "string" && item) return item.slice(0, 160);
  }
  if (typeof record.error === "string" && record.error) return record.error;
  return `http_${httpStatus}`;
}

async function call(
  connection: EvolutionConnection,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, connection.baseUrl), {
      method: init.method ?? "GET",
      headers: {
        apikey: connection.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error";
    throw new EvolutionRequestError({ httpStatus: 0, reason });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // empty or non-JSON body
  }
  if (!response.ok) {
    throw new EvolutionRequestError({ httpStatus: response.status, reason: reasonFromBody(body, response.status) });
  }
  return body;
}

// ---------------------------------------------------------------------------
// Instance lifecycle — all with the GLOBAL key
// ---------------------------------------------------------------------------

export interface InstanceSummary {
  name: string;
  id: string | null;
  connectionStatus: string | null;
  token: string | null;
}

/** v2 returns a flat array; v1-style `{ instance: {...} }` items are tolerated. */
export async function fetchInstances(globalKey: EvolutionConnection): Promise<InstanceSummary[]> {
  const body = await call(globalKey, "/instance/fetchInstances");
  const list = Array.isArray(body) ? body : [];
  return list.map((raw) => {
    const item = (raw && typeof raw === "object" && "instance" in raw ? (raw as { instance: unknown }).instance : raw) as
      | Record<string, unknown>
      | undefined;
    const str = (key: string) => (typeof item?.[key] === "string" ? (item[key] as string) : null);
    return {
      name: str("name") ?? str("instanceName") ?? "",
      id: str("id") ?? str("instanceId"),
      connectionStatus: str("connectionStatus") ?? str("status"),
      token: str("token") ?? str("apikey"),
    };
  });
}

export interface CreatedInstance {
  name: string;
  id: string | null;
  /** Instance token ("hash" in the v2 response). */
  token: string | null;
}

export async function createInstance(
  globalKey: EvolutionConnection,
  params: { instanceName: string; webhookUrl: string },
): Promise<CreatedInstance> {
  const body = (await call(globalKey, "/instance/create", {
    method: "POST",
    body: {
      instanceName: params.instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      // v2 nests webhook config; keys are byEvents/base64 (not webhookByEvents).
      webhook: {
        enabled: true,
        url: params.webhookUrl,
        byEvents: false,
        base64: false,
        events: WEBHOOK_EVENTS,
      },
    },
  })) as Record<string, unknown> | null;
  const instance = (body?.instance ?? {}) as Record<string, unknown>;
  const hash = body?.hash;
  return {
    name: typeof instance.instanceName === "string" ? instance.instanceName : params.instanceName,
    id: typeof instance.instanceId === "string" ? instance.instanceId : null,
    token: typeof hash === "string" ? hash : hash && typeof hash === "object" && typeof (hash as Record<string, unknown>).apikey === "string" ? ((hash as Record<string, unknown>).apikey as string) : null,
  };
}

export interface ConnectResult {
  /** Raw QR string (render it as a QR code). */
  code: string | null;
  /** data:image/png;base64,… of the QR. */
  base64: string | null;
  /** 8-character code for "link with phone number" (only when a number was given). */
  pairingCode: string | null;
}

/** With `pairNumber` (digits, country code) Evolution returns a pairing code instead of only a QR. */
export async function connectInstance(
  globalKey: EvolutionConnection,
  instanceName: string,
  pairNumber?: string,
): Promise<ConnectResult> {
  const query = pairNumber ? `?number=${encodeURIComponent(pairNumber)}` : "";
  const body = (await call(globalKey, `/instance/connect/${encodeURIComponent(instanceName)}${query}`)) as Record<
    string,
    unknown
  > | null;
  const str = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : null);
  return { code: str("code"), base64: str("base64"), pairingCode: str("pairingCode") };
}

/** "open" | "close" | "connecting" (or null when the shape is unexpected). */
export async function connectionState(globalKey: EvolutionConnection, instanceName: string): Promise<string | null> {
  const body = (await call(globalKey, `/instance/connectionState/${encodeURIComponent(instanceName)}`)) as Record<
    string,
    unknown
  > | null;
  const instance = (body?.instance ?? body) as Record<string, unknown> | undefined;
  return typeof instance?.state === "string" ? instance.state : null;
}

export async function setWebhook(
  globalKey: EvolutionConnection,
  instanceName: string,
  webhookUrl: string,
): Promise<void> {
  await call(globalKey, `/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false, // true would append "/messages-upsert" etc. to the URL
        base64: false,
        events: WEBHOOK_EVENTS,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Sending — with the INSTANCE token
// ---------------------------------------------------------------------------

export type SendResult =
  | { ok: true; waMessageId: string | null; providerStatus: string | null }
  | { ok: false; error: EvolutionError };

/**
 * Sends the lead message. `delay` makes Evolution show "digitando…" for
 * 1.2 s before sending (v2 sends the composing presence during the delay) —
 * part of the ban-risk mitigation, keep it. `linkPreview` renders the VSL card.
 * The message starts as PENDING; MESSAGES_UPDATE confirms it later.
 */
export async function sendText(params: { phoneE164: string; text: string }): Promise<SendResult> {
  const config = getWhatsAppConfig();
  if (!config.ok) return { ok: false, error: { httpStatus: 0, reason: "not_configured" } };
  const env = config.env;
  // Instance token, not the global key: sending is an instance-scoped operation.
  const instanceToken: EvolutionConnection = { baseUrl: env.EVOLUTION_BASE_URL, apiKey: env.EVOLUTION_INSTANCE_TOKEN };
  try {
    const body = (await call(instanceToken, `/message/sendText/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`, {
      method: "POST",
      body: {
        number: params.phoneE164.replace(/\D/g, ""), // digits only, country code, no "+"/@suffix
        text: params.text,
        delay: 1200,
        linkPreview: true,
      },
    })) as Record<string, unknown> | null;
    const keyOf = (o: unknown) =>
      o && typeof o === "object" ? ((o as Record<string, unknown>).key as Record<string, unknown> | undefined) : undefined;
    const id = keyOf(body)?.id ?? keyOf(body?.data)?.id;
    const status = typeof body?.status === "string" ? body.status : null;
    return { ok: true, waMessageId: typeof id === "string" && id ? id : null, providerStatus: status };
  } catch (error) {
    if (error instanceof EvolutionRequestError) return { ok: false, error: error.error };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Webhook authentication
// ---------------------------------------------------------------------------

/**
 * Evolution does not sign webhooks. The secret is the last URL path segment;
 * compare it in constant time (hash both sides so lengths always match).
 */
export function verifyWebhookSecret(provided: string | null | undefined): boolean {
  // Checked on its own (not via getWhatsAppConfig) so /api/health works as soon
  // as the secret is set, even before the Evolution server exists.
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET?.trim() ?? "";
  if (!provided || expected.length < 32) return false; // no usable secret → reject everything
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** "abcd…wxyz" — for printing keys/tokens in scripts. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "(none)";
  return value.length <= 10 ? "…" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}
