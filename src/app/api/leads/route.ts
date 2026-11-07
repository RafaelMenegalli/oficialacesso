/**
 * POST /api/leads — the VSL lock modal submits { name, phone, consent } here.
 *
 * 1. rate-limit by IP (5/min), validate + normalise (Zod), require consent;
 * 2. upsert the lead on phone (a repeat updates the name, never duplicates);
 * 3. send the approved MARKETING template once — never again for a lead
 *    already in `sent`/`delivered`/`read`;
 * 4. on failure return a wa.me fallback link so the lead is never stranded.
 *
 * Responses never contain the phone or any id other than `leadId`.
 */
import { getDb } from "@/lib/db";
import { log, maskPhone } from "@/lib/log";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { leadRequestSchema, type LeadResponse } from "@/lib/validation";
import {
  assertTemplateApproved,
  buildWaLink,
  firstNameOf,
  sendTemplate,
  TemplateNotApprovedError,
} from "@/lib/zapi";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const ALREADY_SENT = new Set(["sent", "delivered", "read"]);

const MSG = {
  rateLimited: "Muitas tentativas seguidas. Aguarde um minuto e tente novamente.",
  badRequest: "Não foi possível ler os dados enviados. Recarregue a página e tente novamente.",
  sendFailed:
    "Não conseguimos enviar o vídeo para o seu WhatsApp agora. Toque na alternativa abaixo para recebê-lo.",
  unavailable:
    "O envio pelo WhatsApp está temporariamente indisponível. Toque na alternativa abaixo para receber o vídeo.",
  internal: "Algo deu errado do nosso lado. Tente novamente em instantes.",
} as const;

/**
 * Serialises sends per phone inside this process, so a double-click or two
 * tabs can't both pass the "not sent yet" check and bill two templates.
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

      // Template must be APPROVED before Meta will accept it; fail fast and clearly.
      try {
        await assertTemplateApproved();
      } catch (error) {
        const code = error instanceof TemplateNotApprovedError ? `template_${error.status.toLowerCase()}` : "template_check_failed";
        log.error("leads.template_unusable", {
          leadId: lead.id,
          code,
          detail: error instanceof Error ? error.message : "unknown",
        });
        await db.lead.update({ where: { id: lead.id }, data: { status: "failed", replyError: code } });
        return json(
          { status: "failed", leadId: lead.id, message: MSG.unavailable, fallbackUrl: buildWaLink(firstName) },
          200,
        );
      }

      const result = await sendTemplate({ phoneE164: phone, firstName });

      if (result.ok) {
        await db.$transaction([
          db.lead.update({
            where: { id: lead.id },
            data: { status: "sent", providerMessageId: result.messageId, replyError: null },
          }),
          db.messageLog.create({
            data: {
              leadId: lead.id,
              direction: "outbound",
              providerMessageId: result.messageId,
              kind: "template",
              body: `template:${firstName}`,
              status: "sent",
            },
          }),
        ]);
        log.info("leads.template_sent", { leadId: lead.id, phone: masked });
        return json({ status: "sent", leadId: lead.id }, 200);
      }

      const { code, httpStatus } = result.error;
      await db.$transaction([
        db.lead.update({ where: { id: lead.id }, data: { status: "failed", replyError: code } }),
        db.messageLog.create({
          data: {
            leadId: lead.id,
            direction: "outbound",
            // No provider id on a rejected send: synthetic key keeps the audit row unique.
            providerMessageId: `rejected:${lead.id}:${now.getTime()}`,
            kind: "template",
            status: "failed",
            errorCode: code,
          },
        }),
      ]);
      log.warn("leads.template_failed", { leadId: lead.id, phone: masked, code, httpStatus });

      const message = code === "CHANNEL_DISCONNECTED" ? MSG.unavailable : MSG.sendFailed;
      return json({ status: "failed", leadId: lead.id, message, fallbackUrl: buildWaLink(firstName) }, 200);
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    log.error("leads.unexpected_error", { detail: error instanceof Error ? error.name : "unknown", code });
    return json({ status: "failed", message: MSG.internal }, 500);
  }
}
