import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Omni Z-API (official WhatsApp Cloud API, CoEX) helpers.
 * Endpoints verified against developer.omni.z-api.io on 2026-11-06:
 *   POST /v1/channels/{channelId}/messages            send template
 *   GET  /whatsapp/businesses/{wabaId}/templates      list templates
 * Auth: `Authorization: Bearer <Secret Key>` (no Client-Token on Omni).
 */

const REQUEST_TIMEOUT_MS = 10_000;
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
 * Phones as stored on leads that a WhatsApp id may refer to. WhatsApp often
 * reports older Brazilian mobiles without the 9th digit (55 DD XXXXXXXX), so
 * both forms are matched.
 */
export function leadPhoneCandidates(providerPhone: string): string[] {
  const digits = providerPhone.replace(/\D/g, "");
  if (!digits.startsWith("55")) return [`+${digits}`];
  if (digits.length === 13) return [`+${digits}`];
  if (digits.length === 12) return [`+${digits}`, `+${digits.slice(0, 4)}9${digits.slice(4)}`];
  return [`+${digits}`];
}

// ---------------------------------------------------------------------------
// Fallback link
// ---------------------------------------------------------------------------

/**
 * SAFETY NET, NOT A PAID PATH: when the template send fails, the visitor gets
 * a wa.me link that opens a chat with the business, pre-filled with a greeting.
 * If she sends it, Meta's 24 h service window opens and the owner can reply
 * manually from the WhatsApp Business app for free.
 */
export function buildWaLink(firstName: string): string {
  const { WHATSAPP_BUSINESS_PHONE } = getServerEnv();
  const greeting = `Oi! Meu nome é ${firstName} e quero receber o vídeo completo da Sensitiva.`;
  return `https://wa.me/${WHATSAPP_BUSINESS_PHONE}?text=${encodeURIComponent(greeting)}`;
}

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

// ---------------------------------------------------------------------------
// 24 h service window
// ---------------------------------------------------------------------------

/** True while Meta's customer-service window (24 h after her last message) is open. */
export function isWindowOpen(lastInboundAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Provider error envelope, reduced to the code — never the whole payload. */
export interface ProviderError {
  httpStatus: number;
  /** subCode ?? code ?? error, e.g. "CHANNEL_DISCONNECTED", "VALIDATION_ERROR", "132001". */
  code: string;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${getServerEnv().ZAPI_SECRET_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      for (const key of ["subCode", "code", "error"] as const) {
        const value = record[key];
        if (typeof value === "string" && value) return value;
        if (typeof value === "number") return String(value);
      }
    }
  } catch {
    // Non-JSON body: fall through to the HTTP status.
  }
  return `http_${response.status}`;
}

class ProviderRequestError extends Error {
  constructor(readonly providerError: ProviderError) {
    super(`Omni Z-API request failed: ${providerError.code} (HTTP ${providerError.httpStatus})`);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const { ZAPI_BASE_URL } = getServerEnv();
  let response: Response;
  try {
    response = await fetch(new URL(path, ZAPI_BASE_URL), {
      ...init,
      headers: headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error";
    throw new ProviderRequestError({ httpStatus: 0, code });
  }
  if (!response.ok) {
    throw new ProviderRequestError({ httpStatus: response.status, code: await readErrorCode(response) });
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Template approval check (cached for the process lifetime once approved)
// ---------------------------------------------------------------------------

export class TemplateNotApprovedError extends Error {
  constructor(readonly status: string) {
    super(
      `WhatsApp template is not usable (status: ${status}). ` +
        `Check WHATSAPP_TEMPLATE_NAME / WHATSAPP_TEMPLATE_LANG and the template's review in the Omni Z-API panel, ` +
        `or run "npm run whatsapp:template". See docs/WHATSAPP.md.`,
    );
  }
}

interface TemplateListPage {
  data?: { name?: string; language?: string; status?: string }[];
  paging?: { cursors?: { after?: string } };
}

let templateApproved = false;

/**
 * Throws TemplateNotApprovedError unless the configured template exists in the
 * configured language with status APPROVED. Only a positive result is cached,
 * so a pending template is re-checked on the next lead.
 */
export async function assertTemplateApproved(): Promise<void> {
  if (templateApproved) return;
  const { ZAPI_WABA_ID, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG } = getServerEnv();

  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const result = (await request(
      `/whatsapp/businesses/${encodeURIComponent(ZAPI_WABA_ID)}/templates?${query}`,
    )) as TemplateListPage;

    const match = result.data?.find(
      (t) => t.name === WHATSAPP_TEMPLATE_NAME && t.language === WHATSAPP_TEMPLATE_LANG,
    );
    if (match) {
      if (match.status === "APPROVED") {
        templateApproved = true;
        log.info("whatsapp.template.approved", { template: WHATSAPP_TEMPLATE_NAME });
        return;
      }
      throw new TemplateNotApprovedError(match.status ?? "UNKNOWN");
    }
    after = result.paging?.cursors?.after;
    if (!after || !result.data?.length) break;
  }
  throw new TemplateNotApprovedError("NOT_FOUND");
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SendResult = { ok: true; messageId: string } | { ok: false; error: ProviderError };

/**
 * Sends the approved MARKETING template. Body has exactly one positional
 * variable ({{1}} = first name); the URL button is static, so it takes no
 * parameter. Billed by Meta per delivered message.
 */
export async function sendTemplate(params: { phoneE164: string; firstName: string }): Promise<SendResult> {
  const { ZAPI_CHANNEL_ID, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG } = getServerEnv();
  const payload = {
    recipient: { identifier: params.phoneE164.replace(/^\+/, "") },
    content: {
      type: "TEMPLATE",
      attachments: [
        {
          template: {
            name: WHATSAPP_TEMPLATE_NAME,
            language: { policy: "deterministic", code: WHATSAPP_TEMPLATE_LANG },
            components: [{ type: "body", parameters: [{ type: "text", text: params.firstName }] }],
          },
        },
      ],
    },
  };

  try {
    const result = (await request(`/v1/channels/${encodeURIComponent(ZAPI_CHANNEL_ID)}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    })) as { messageId?: unknown };
    if (typeof result.messageId !== "string" || !result.messageId) {
      return { ok: false, error: { httpStatus: 200, code: "missing_message_id" } };
    }
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    if (error instanceof ProviderRequestError) return { ok: false, error: error.providerError };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Webhook authentication
// ---------------------------------------------------------------------------

/** Constant-time comparison of the shared webhook secret (header or query). */
export function verifyWebhookSecret(provided: string | null | undefined): boolean {
  if (!provided) return false;
  // Hash both sides so lengths match and timingSafeEqual can't throw or leak length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(getServerEnv().ZAPI_WEBHOOK_SECRET).digest();
  return timingSafeEqual(a, b);
}

const SIGNATURE_TOLERANCE_SEC = 300;

/**
 * Omni Z-API HMAC (webhook created with signing: true). Signed string is
 * "{t}\n{topic}\n{partition}\n{offset}\n{body}", topic/partition/offset coming
 * from x-idempotency-key. `rawBody` must be the decompressed bytes as received.
 * Returns "skipped" when no signing secret is configured.
 */
export function verifyWebhookSignature(input: {
  rawBody: Buffer;
  signatureHeader: string | null;
  idempotencyHeader: string | null;
}): "valid" | "invalid" | "skipped" {
  const secret = getServerEnv().ZAPI_WEBHOOK_SIGNING_SECRET;
  if (!secret) return "skipped";
  const { signatureHeader, idempotencyHeader, rawBody } = input;
  if (!signatureHeader || !idempotencyHeader) return "invalid";

  const parts = new Map<string, string>();
  for (const pair of signatureHeader.split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) parts.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1 || !/^[0-9a-f]+$/i.test(v1)) return "invalid";

  const last = idempotencyHeader.lastIndexOf(":");
  const prev = idempotencyHeader.lastIndexOf(":", last - 1);
  if (last < 0 || prev < 0) return "invalid";
  const topic = idempotencyHeader.slice(0, prev);
  const partition = idempotencyHeader.slice(prev + 1, last);
  const offset = idempotencyHeader.slice(last + 1);

  const canonical = Buffer.concat([Buffer.from(`${t}\n${topic}\n${partition}\n${offset}\n`, "utf8"), rawBody]);
  const expected = createHmac("sha256", secret).update(canonical).digest();
  const received = Buffer.from(v1, "hex");
  const valid = expected.length === received.length && timingSafeEqual(expected, received);
  const fresh = Math.abs(Math.floor(Date.now() / 1000) - Number(t)) <= SIGNATURE_TOLERANCE_SEC;
  return valid && fresh ? "valid" : "invalid";
}
