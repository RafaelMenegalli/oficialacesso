/**
 * POST /api/whatsapp/webhook — Omni Z-API channel webhook (payloadFormat Z_API).
 *
 * Auth: shared secret in the `x-webhook-secret` header (registered as a
 * CUSTOM_HEADER auth on the webhook) or `?token=` query, compared in constant
 * time → 401 on mismatch. If ZAPI_WEBHOOK_SIGNING_SECRET is set, the Omni HMAC
 * signature is verified too.
 *
 * Omni retries anything that isn't 2xx within 5 s, so we acknowledge first
 * and process in `after()`. Idempotency: every handled event writes a
 * MessageLog row keyed by a unique providerMessageId; a replay hits the
 * unique constraint and changes nothing.
 *
 * Never replies to anyone: the template is the only outbound message.
 */
import { gunzipSync } from "node:zlib";
import { after } from "next/server";
import type { LeadStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { log, maskPhone } from "@/lib/log";
import {
  connectionCallbackSchema,
  deliveryCallbackSchema,
  messageStatusCallbackSchema,
  receivedCallbackSchema,
  webhookEnvelopeSchema,
  type ConnectionCallback,
  type DeliveryCallback,
  type MessageStatusCallback,
  type ReceivedCallback,
} from "@/lib/validation";
import { leadPhoneCandidates, verifyWebhookSecret, verifyWebhookSignature } from "@/lib/zapi";

const RANK: Record<LeadStatus, number> = { captured: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

/** Z-API status → lead status. RECEIVED means delivered to her phone. */
function mapStatus(status: string): LeadStatus | null {
  switch (status.toUpperCase()) {
    case "SENT":
      return "sent";
    case "RECEIVED":
    case "DELIVERED":
      return "delivered";
    case "READ":
    case "PLAYED":
      return "read";
    case "FAILED":
    case "ERROR":
      return "failed";
    default:
      return null; // READ_BY_ME etc.: not about the lead's progress
  }
}

const ack = () => Response.json({ received: true }, { status: 200 });

export async function POST(request: Request) {
  const url = new URL(request.url);
  const provided = request.headers.get("x-webhook-secret") ?? url.searchParams.get("token");
  if (!verifyWebhookSecret(provided)) {
    log.warn("webhook.unauthorized");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let rawBody = Buffer.from(await request.arrayBuffer());
  if (request.headers.get("content-encoding")?.toLowerCase() === "gzip") {
    try {
      rawBody = gunzipSync(rawBody);
    } catch {
      log.warn("webhook.bad_gzip");
      return Response.json({ error: "bad_body" }, { status: 400 });
    }
  }

  const signature = verifyWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("x-webhook-signature"),
    idempotencyHeader: request.headers.get("x-idempotency-key"),
  });
  if (signature === "invalid") {
    log.warn("webhook.bad_signature");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    log.warn("webhook.bad_json");
    return ack(); // 4xx would only make Omni stop; nothing useful to retry.
  }

  const events = Array.isArray(payload) ? payload : [payload];
  after(async () => {
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (error) {
        log.error("webhook.processing_failed", { detail: error instanceof Error ? error.name : "unknown" });
      }
    }
  });
  return ack();
}

async function handleEvent(event: unknown): Promise<void> {
  const envelope = webhookEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    log.debug("webhook.ignored", { reason: "no_type" });
    return;
  }
  switch (envelope.data.type) {
    case "ReceivedCallback": {
      const parsed = receivedCallbackSchema.safeParse(event);
      if (parsed.success) await handleInbound(parsed.data);
      else log.warn("webhook.invalid_payload", { type: "ReceivedCallback" });
      return;
    }
    case "MessageStatusCallback": {
      const parsed = messageStatusCallbackSchema.safeParse(event);
      if (parsed.success) await handleStatus(parsed.data);
      else log.warn("webhook.invalid_payload", { type: "MessageStatusCallback" });
      return;
    }
    case "DeliveryCallback": {
      const parsed = deliveryCallbackSchema.safeParse(event);
      if (parsed.success) await handleDelivery(parsed.data);
      else log.warn("webhook.invalid_payload", { type: "DeliveryCallback" });
      return;
    }
    case "ConnectedCallback":
    case "DisconnectedCallback": {
      const parsed = connectionCallbackSchema.safeParse(event);
      if (parsed.success) handleConnection(parsed.data);
      return;
    }
    default:
      log.debug("webhook.ignored", { type: envelope.data.type });
  }
}

/**
 * Inserts the idempotency row. Returns false when this event was already
 * processed (unique violation on providerMessageId).
 */
async function recordOnce(data: Prisma.MessageLogUncheckedCreateInput): Promise<boolean> {
  try {
    await getDb().messageLog.create({ data });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function handleInbound(event: ReceivedCallback): Promise<void> {
  if (event.isGroup || event.fromMe || event.isNewsletter || event.broadcast) {
    log.debug("webhook.inbound_ignored", { reason: event.fromMe ? "from_me" : "group_or_broadcast" });
    return;
  }
  const db = getDb();
  const lead = await db.lead.findFirst({ where: { phone: { in: leadPhoneCandidates(event.phone) } } });
  if (!lead) {
    // Owner's other contacts write to this number too — none of our business.
    log.info("webhook.inbound_unknown_number", { phone: maskPhone(event.phone) });
    return;
  }

  const at = event.momment ? new Date(event.momment) : new Date();
  const fresh = await recordOnce({
    leadId: lead.id,
    direction: "inbound",
    providerMessageId: event.messageId,
    kind: "text",
    body: event.text?.message ?? null,
  });
  if (!fresh) return;

  await db.lead.update({
    where: { id: lead.id },
    data: {
      firstInboundAt: lead.firstInboundAt ?? at,
      lastInboundAt: !lead.lastInboundAt || at > lead.lastInboundAt ? at : lead.lastInboundAt,
    },
  });
  // Deliberately no auto-reply: the template already went out; the owner replies manually.
  log.info("webhook.inbound", { leadId: lead.id, windowOpenUntil: new Date(at.getTime() + 86_400_000).toISOString() });
  log.debug("webhook.inbound_body", { leadId: lead.id, body: event.text?.message ?? null });
}

async function advanceLead(providerMessageId: string, next: LeadStatus, errorCode: string | null): Promise<void> {
  const db = getDb();
  const lead = await db.lead.findFirst({ where: { providerMessageId } });
  if (!lead) {
    log.debug("webhook.status_unknown_message");
    return;
  }

  if (next === "failed") {
    // A failure only counts while the message hasn't been confirmed further.
    if (RANK[lead.status] >= RANK.delivered) return;
    await db.lead.update({ where: { id: lead.id }, data: { status: "failed", replyError: errorCode ?? "delivery_failed" } });
    log.warn("webhook.lead_failed", { leadId: lead.id, code: errorCode ?? "delivery_failed" });
    return;
  }

  // Only move forward: "read" may arrive before a retried "delivered".
  if (RANK[next] <= RANK[lead.status] && lead.status !== "failed") return;
  await db.lead.update({ where: { id: lead.id }, data: { status: next } });
  log.info("webhook.lead_status", { leadId: lead.id, status: next });
}

async function handleStatus(event: MessageStatusCallback): Promise<void> {
  if (event.isGroup) return;
  const next = mapStatus(event.status);
  if (!next) return;
  const errorCode = event.errorCode !== undefined ? String(event.errorCode) : (event.error ?? null);

  for (const id of event.ids) {
    const lead = await getDb().lead.findFirst({ where: { providerMessageId: id }, select: { id: true } });
    if (!lead) continue; // owner's manual messages also produce statuses
    const fresh = await recordOnce({
      leadId: lead.id,
      direction: "outbound",
      providerMessageId: `${id}:${event.status.toUpperCase()}`,
      kind: "status",
      status: event.status.toUpperCase(),
      errorCode: next === "failed" ? errorCode : null,
    });
    if (fresh) await advanceLead(id, next, errorCode);
  }
}

async function handleDelivery(event: DeliveryCallback): Promise<void> {
  if (!event.error) return; // success is covered by MessageStatusCallback SENT
  const lead = await getDb().lead.findFirst({ where: { providerMessageId: event.messageId }, select: { id: true } });
  if (!lead) return;
  const errorCode = event.errorCode !== undefined ? String(event.errorCode) : event.error;
  const fresh = await recordOnce({
    leadId: lead.id,
    direction: "outbound",
    providerMessageId: `${event.messageId}:DELIVERY_ERROR`,
    kind: "status",
    status: "FAILED",
    errorCode,
  });
  if (fresh) await advanceLead(event.messageId, "failed", errorCode);
}

function handleConnection(event: ConnectionCallback): void {
  if (event.type === "ConnectedCallback") {
    log.info("whatsapp.connected");
    return;
  }
  // CoEX lapsed — usually the WhatsApp Business app wasn't opened for ~14 days.
  log.error("whatsapp.disconnected", {
    hint: "Open the WhatsApp Business app on the phone, then reconnect the channel in the Omni Z-API panel",
    reason: event.error ?? null,
  });
}
