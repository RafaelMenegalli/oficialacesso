import { z } from "zod";
import { normalizePhone, PHONE_ERROR_MESSAGES } from "@/lib/zapi";

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
// POST /api/whatsapp/webhook — Omni Z-API, payloadFormat "Z_API"
// Shapes from developer.z-api.io (Omni keeps the same structure).
// Unknown fields are allowed; unknown event types are ignored by the route.
// ---------------------------------------------------------------------------

const timestamp = z.number().int().nonnegative().optional();

export const receivedCallbackSchema = z.looseObject({
  type: z.literal("ReceivedCallback"),
  messageId: z.string().min(1),
  phone: z.string().min(1),
  fromMe: z.boolean().optional(),
  isGroup: z.boolean().optional(),
  isNewsletter: z.boolean().optional(),
  broadcast: z.boolean().optional(),
  momment: timestamp,
  text: z.looseObject({ message: z.string().optional() }).optional(),
});

export const messageStatusCallbackSchema = z.looseObject({
  type: z.literal("MessageStatusCallback"),
  status: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1),
  phone: z.string().optional(),
  isGroup: z.boolean().optional(),
  momment: timestamp,
  error: z.string().optional(),
  errorCode: z.union([z.string(), z.number()]).optional(),
});

/** "Ao enviar": success has no `error`; failure carries `error` (+ maybe `errorCode`). */
export const deliveryCallbackSchema = z.looseObject({
  type: z.literal("DeliveryCallback"),
  messageId: z.string().min(1),
  phone: z.string().optional(),
  momment: timestamp,
  error: z.string().optional(),
  errorCode: z.union([z.string(), z.number()]).optional(),
});

export const connectionCallbackSchema = z.looseObject({
  type: z.enum(["ConnectedCallback", "DisconnectedCallback"]),
  momment: timestamp,
  error: z.string().optional(),
});

export const webhookEnvelopeSchema = z.looseObject({ type: z.string() });

export type ReceivedCallback = z.infer<typeof receivedCallbackSchema>;
export type MessageStatusCallback = z.infer<typeof messageStatusCallbackSchema>;
export type DeliveryCallback = z.infer<typeof deliveryCallbackSchema>;
export type ConnectionCallback = z.infer<typeof connectionCallbackSchema>;
