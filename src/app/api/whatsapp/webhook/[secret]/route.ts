/**
 * POST /api/whatsapp/webhook/[secret] — Evolution API v2 instance webhook
 * (webhookByEvents false: every event arrives on this one URL).
 *
 * Auth: Evolution does not sign webhooks, so the last path segment must equal
 * EVOLUTION_WEBHOOK_SECRET (constant-time compare) → 401 before the body is read.
 *
 * Evolution retries non-2xx (its timeout is 60 s), so we acknowledge first and
 * process in `after()`. Idempotency: every handled event inserts a MessageLog
 * row keyed by a unique waMessageId; a replay hits the constraint and changes
 * nothing. Never replies to anyone — the lead message is the only outbound one.
 *
 * The payload carries the instance token in `apikey`: never log raw bodies.
 */
import { after } from "next/server";
import type { LeadStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { phoneCandidatesFromJid, verifyWebhookSecret } from "@/lib/evolution";
import { log, maskPhone } from "@/lib/log";
import {
  connectionUpdateSchema,
  messageUpdateSchema,
  messageUpsertSchema,
  webhookEnvelopeSchema,
  type ConnectionUpdate,
  type MessageUpdate,
  type MessageUpsert,
} from "@/lib/validation";

const RANK: Record<LeadStatus, number> = { captured: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

/** Baileys ack (name or number) → lead status. PENDING carries no new information. */
function mapStatus(status: string | number | undefined): { lead: LeadStatus; label: string } | null {
  const byNumber = ["ERROR", "PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "PLAYED"];
  const label = typeof status === "number" ? byNumber[status] : status?.toUpperCase();
  switch (label) {
    case "SERVER_ACK":
      return { lead: "sent", label };
    case "DELIVERY_ACK":
      return { lead: "delivered", label };
    case "READ":
    case "PLAYED":
      return { lead: "read", label };
    case "ERROR":
      return { lead: "failed", label };
    default:
      return null;
  }
}

const isIgnoredJid = (jid: string) =>
  jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");

const ack = () => Response.json({ received: true }, { status: 200 });

export async function POST(request: Request, ctx: RouteContext<"/api/whatsapp/webhook/[secret]">) {
  const { secret } = await ctx.params;
  if (!verifyWebhookSecret(secret)) {
    log.warn("webhook.unauthorized");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    log.warn("webhook.bad_json");
    return ack(); // a 4xx would only make Evolution retry or give up; nothing to process
  }

  after(async () => {
    try {
      await handleEvent(payload);
    } catch (error) {
      log.error("webhook.processing_failed", { detail: error instanceof Error ? error.name : "unknown" });
    }
  });
  return ack();
}

async function handleEvent(payload: unknown): Promise<void> {
  const envelope = webhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    log.debug("webhook.ignored", { reason: "no_event" });
    return;
  }
  const { event, data } = envelope.data;
  switch (event.toLowerCase().replace(/_/g, ".")) {
    case "messages.upsert": {
      const parsed = messageUpsertSchema.safeParse(data);
      if (parsed.success) await handleUpsert(parsed.data);
      else log.warn("webhook.invalid_payload", { event });
      return;
    }
    case "messages.update": {
      // Some builds batch updates in an array.
      for (const item of Array.isArray(data) ? data : [data]) {
        const parsed = messageUpdateSchema.safeParse(item);
        if (parsed.success) await handleUpdate(parsed.data);
        else log.warn("webhook.invalid_payload", { event });
      }
      return;
    }
    case "connection.update": {
      const parsed = connectionUpdateSchema.safeParse(data);
      if (parsed.success) handleConnection(parsed.data);
      return;
    }
    case "send.message":
      log.debug("webhook.send_echo");
      return;
    default:
      log.debug("webhook.ignored", { event });
  }
}

/** Inserts the idempotency row; false when this event was already processed. */
async function recordOnce(data: Prisma.MessageLogUncheckedCreateInput): Promise<boolean> {
  try {
    await getDb().messageLog.create({ data });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function handleUpsert(message: MessageUpsert): Promise<void> {
  const { key } = message;
  if (key.fromMe) {
    log.debug("webhook.outbound_echo"); // our own send (or the owner typing in the app)
    return;
  }
  if (isIgnoredJid(key.remoteJid)) return;

  // Newer WhatsApp may address chats by "@lid"; the phone JID then comes in remoteJidAlt/senderPn.
  const phoneJid = key.remoteJid.endsWith("@lid") ? (key.remoteJidAlt ?? key.senderPn ?? "") : key.remoteJid;
  const candidates = phoneCandidatesFromJid(phoneJid);
  const db = getDb();
  const lead = candidates.length ? await db.lead.findFirst({ where: { phone: { in: candidates } } }) : null;
  if (!lead) {
    // The owner's other contacts write to this number too — none of our business.
    log.info("webhook.inbound_unknown_number", { phone: candidates[0] ? maskPhone(candidates[0]) : "lid" });
    return;
  }

  const body = message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? null;
  const fresh = await recordOnce({
    leadId: lead.id,
    direction: "inbound",
    waMessageId: key.id,
    kind: "text",
    body,
  });
  if (!fresh) return;

  if (!lead.firstInboundAt) {
    await db.lead.update({ where: { id: lead.id }, data: { firstInboundAt: new Date() } });
  }
  // Deliberately no auto-reply: she already got the message; the owner answers by hand.
  log.info("webhook.inbound", { leadId: lead.id });
  log.debug("webhook.inbound_body", { leadId: lead.id, body });
}

async function handleUpdate(update: MessageUpdate): Promise<void> {
  if (update.remoteJid && isIgnoredJid(update.remoteJid)) return;
  if (update.fromMe === false) return; // read receipts of her messages, not ours
  const messageId = update.keyId ?? update.key?.id ?? update.messageId;
  const mapped = mapStatus(update.status ?? update.update?.status);
  if (!messageId || !mapped) return;

  const db = getDb();
  const lead = await db.lead.findFirst({ where: { waMessageId: messageId } });
  if (!lead) return; // the owner's manual messages also produce updates

  const fresh = await recordOnce({
    leadId: lead.id,
    direction: "outbound",
    waMessageId: `${messageId}:${mapped.label}`,
    kind: "status",
    status: mapped.label,
    errorCode: mapped.lead === "failed" ? "ERROR" : null,
  });
  if (!fresh) return;

  if (mapped.lead === "failed") {
    if (RANK[lead.status] >= RANK.delivered) return; // a late error can't undo a delivery
    await db.lead.update({ where: { id: lead.id }, data: { status: "failed", replyError: "delivery_error" } });
    log.warn("webhook.lead_failed", { leadId: lead.id });
    return;
  }
  // Only move forward: "read" may arrive before a retried "delivered".
  if (RANK[mapped.lead] <= RANK[lead.status] && lead.status !== "failed") return;
  await db.lead.update({ where: { id: lead.id }, data: { status: mapped.lead } });
  log.info("webhook.lead_status", { leadId: lead.id, status: mapped.lead });
}

function handleConnection(update: ConnectionUpdate): void {
  if (update.state === "open") {
    log.info("whatsapp.connected");
  } else if (update.state === "close") {
    // Linked device dropped: the owner must rescan the QR (npm run whatsapp:setup).
    log.warn("whatsapp.disconnected", {
      reason: update.statusReason !== undefined ? String(update.statusReason) : null,
      hint: "Run npm run whatsapp:setup and scan the QR again",
    });
  } else {
    log.debug("whatsapp.connection_state", { state: update.state ?? null });
  }
}
