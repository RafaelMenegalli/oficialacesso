import { z } from "zod";
import { normalizePhone, PHONE_ERROR_MESSAGES } from "@/lib/evolution";

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------

/**
 * Lead form. Messages are Portuguese because they go straight to the modal.
 * `phone` is transformed to E.164; `consent` must be literally `true`.
 */
export const leadRequestSchema = z.object({
  name: z
    .string({ error: "Informe seu nome." })
    .trim()
    .transform((value) => value.replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(2, { error: "Informe seu nome (pelo menos 2 letras)." })
        .max(80, { error: "Nome muito longo." }),
    ),
  phone: z
    .string({ error: "Informe seu WhatsApp com DDD." })
    .transform((value, ctx) => {
      const result = normalizePhone(value);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: PHONE_ERROR_MESSAGES[result.error] });
        return z.NEVER;
      }
      return result.e164;
    }),
  consent: z.literal(true, {
    error: "Para receber o vídeo, marque a autorização de mensagens no WhatsApp.",
  }),
});

export type LeadRequest = z.infer<typeof leadRequestSchema>;

/** Response contract shared by the route and the modal. */
export type LeadResponse =
  | { status: "sent"; leadId: string }
  | { status: "failed"; leadId?: string; message: string; fallbackUrl?: string };

// ---------------------------------------------------------------------------
// POST /api/whatsapp/webhook/[secret] — Evolution API v2 webhook
// Envelope: { event, instance, data, date_time, sender, server_url, apikey }.
// `event` is lower-case with dots ("messages.upsert"). Unknown fields are
// allowed; unknown events are ignored by the route.
// ---------------------------------------------------------------------------

export const webhookEnvelopeSchema = z.looseObject({
  event: z.string(),
  instance: z.string().optional(),
  data: z.unknown(),
});

const messageKeySchema = z.looseObject({
  id: z.string().min(1),
  remoteJid: z.string().min(1),
  fromMe: z.boolean(),
  /** Phone JID when remoteJid is a privacy "@lid" identifier (newer WhatsApp). */
  remoteJidAlt: z.string().optional(),
  senderPn: z.string().optional(),
});

/** messages.upsert / send.message: one message (inbound, or echo of our send). */
export const messageUpsertSchema = z.looseObject({
  key: messageKeySchema,
  pushName: z.string().nullish(),
  message: z
    .looseObject({
      conversation: z.string().nullish(),
      extendedTextMessage: z.looseObject({ text: z.string().nullish() }).nullish(),
    })
    .nullish(),
  messageType: z.string().nullish(),
  messageTimestamp: z.union([z.number(), z.string()]).nullish(),
});

/**
 * messages.update. v2.3.x sends { keyId, remoteJid, fromMe, status };
 * older builds send { key: {...}, update: { status } }. Both are accepted.
 */
export const messageUpdateSchema = z.looseObject({
  keyId: z.string().optional(),
  messageId: z.string().optional(),
  key: z.looseObject({ id: z.string().optional() }).optional(),
  remoteJid: z.string().optional(),
  fromMe: z.boolean().optional(),
  status: z.union([z.string(), z.number()]).optional(),
  update: z.looseObject({ status: z.union([z.string(), z.number()]).optional() }).optional(),
});

/** connection.update: { state: "open" | "close" | "connecting", statusReason? } */
export const connectionUpdateSchema = z.looseObject({
  state: z.string().optional(),
  statusReason: z.union([z.number(), z.string()]).optional(),
});

export type MessageUpsert = z.infer<typeof messageUpsertSchema>;
export type MessageUpdate = z.infer<typeof messageUpdateSchema>;
export type ConnectionUpdate = z.infer<typeof connectionUpdateSchema>;
