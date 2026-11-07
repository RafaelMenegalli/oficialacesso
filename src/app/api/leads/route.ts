/**
 * POST /api/leads — the VSL lock modal submits { name, phone, consent } here.
 *
 * 1. rate-limit by IP (5/min), validate + normalise (Zod), require consent;
 * 2. upsert the lead on phone (a repeat updates the name, never duplicates);
 * 3. send ONE WhatsApp text through Evolution API — never again for a lead
 *    already in `sent`/`delivered`/`read`;
 * 4. on failure return a wa.me fallback link so the lead is never stranded.
 *
 * Responses never contain the phone or any id other than `leadId`.
 */
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { buildLeadMessage, buildWaLink, firstNameOf, sendText } from "@/lib/evolution";
import { log, maskPhone } from "@/lib/log";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { leadRequestSchema, type LeadResponse } from "@/lib/validation";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const ALREADY_SENT = new Set(["sent", "delivered", "read"]);

const MSG = {
  rateLimited: "Muitas tentativas seguidas. Aguarde um minuto e tente novamente.",
  badRequest: "Não foi possível ler os dados enviados. Recarregue a página e tente novamente.",
  notOnWhatsapp:
    "Não encontramos WhatsApp neste número. Confira o número digitado ou toque na alternativa abaixo.",
  sendFailed:
    "Não conseguimos enviar o vídeo para o seu WhatsApp agora. Toque na alternativa abaixo para recebê-lo.",
  internal: "Algo deu errado do nosso lado. Tente novamente em instantes.",
} as const;

/**
 * Serialises sends per phone inside this process, so a double-click or two
 * tabs can't both pass the "not sent yet" check and message her twice.
 */
const inFlight = new Map<string, Promise<unknown>>();
async function withPhoneLock<T>(phone: string, task: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(phone) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  inFlight.set(phone, current);
  try {
    return await current;
  } finally {
    if (inFlight.get(phone) === current) inFlight.delete(phone);
  }
}

function json(body: LeadResponse, status: number, extraHeaders?: HeadersInit) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);

  const limit = rateLimit(`leads:${ip ?? "unknown"}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    log.warn("leads.rate_limited");
    return json({ status: "failed", message: MSG.rateLimited }, 429, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ status: "failed", message: MSG.badRequest }, 400);
  }

  const parsed = leadRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? MSG.badRequest;
    log.info("leads.rejected", { field: String(parsed.error.issues[0]?.path[0] ?? "body") });
    return json({ status: "failed", message }, 422);
  }

  const { name, phone } = parsed.data;
  const firstName = firstNameOf(name);
  const masked = maskPhone(phone);

  try {
    return await withPhoneLock(phone, async () => {
      const db = getDb();
      const now = new Date();
      const lead = await db.lead.upsert({
        where: { phone },
        create: { name, phone, consentAt: now, consentIp: ip },
        update: { name, consentAt: now, consentIp: ip },
      });

      if (ALREADY_SENT.has(lead.status)) {
        log.info("leads.already_sent", { leadId: lead.id, phone: masked, status: lead.status });
        return json({ status: "sent", leadId: lead.id }, 200);
      }

      const text = buildLeadMessage(firstName, getServerEnv().NEXT_PUBLIC_VSL_URL);
      const result = await sendText({ phoneE164: phone, text });

      if (result.ok) {
        // A missing id is a soft failure: the message most likely went out, so
        // the lead is marked sent (resending would double-message her), but
        // status webhooks can't be matched to it.
        const syntheticId = `sent:${lead.id}:${now.getTime()}`;
        await db.$transaction([
          db.lead.update({
            where: { id: lead.id },
            data: {
              status: "sent",
              waMessageId: result.waMessageId,
              replyError: result.waMessageId ? null : "missing_message_id",
            },
          }),
          db.messageLog.create({
            data: {
              leadId: lead.id,
              direction: "outbound",
              waMessageId: result.waMessageId ?? syntheticId,
              kind: "text",
              body: text,
              status: result.providerStatus ?? "PENDING",
            },
          }),
        ]);
        if (!result.waMessageId) log.warn("leads.sent_without_message_id", { leadId: lead.id });
        log.info("leads.message_sent", { leadId: lead.id, phone: masked });
        log.debug("leads.message_body", { leadId: lead.id, body: text });
        return json({ status: "sent", leadId: lead.id }, 200);
      }

      const { reason, httpStatus } = result.error;
      const replyError = `${httpStatus}:${reason}`.slice(0, 200);
      await db.$transaction([
        db.lead.update({ where: { id: lead.id }, data: { status: "failed", replyError } }),
        db.messageLog.create({
          data: {
            leadId: lead.id,
            direction: "outbound",
            // No WhatsApp id on a rejected send: synthetic key keeps the audit row unique.
            waMessageId: `rejected:${lead.id}:${now.getTime()}`,
            kind: "text",
            status: "failed",
            errorCode: replyError,
          },
        }),
      ]);
      log.warn("leads.message_failed", { leadId: lead.id, phone: masked, httpStatus, reason });

      const message = reason === "not-on-whatsapp" ? MSG.notOnWhatsapp : MSG.sendFailed;
      return json({ status: "failed", leadId: lead.id, message, fallbackUrl: buildWaLink(firstName) }, 200);
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    log.error("leads.unexpected_error", { detail: error instanceof Error ? error.name : "unknown", code });
    return json({ status: "failed", message: MSG.internal }, 500);
  }
}
