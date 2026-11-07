import { z } from "zod";

/**
 * Server environment, validated at boot (src/instrumentation.ts) in two tiers:
 *
 * - CORE (database, links): missing → the server refuses to start.
 * - WHATSAPP (Evolution API): missing → a loud error at boot, but the site
 *   stays up. The VSL keeps working; /api/leads still saves the lead and hands
 *   out the wa.me fallback, and the webhook rejects every call. Deploys are
 *   automatic on push, so a half-configured WhatsApp must never take the
 *   landing page down.
 *
 * Empty strings count as missing. Values are never echoed in errors.
 */
const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, { error: `${name} is required` });

const coreSchema = z.object({
  DATABASE_URL: required("DATABASE_URL"),
  /** Link placed in the WhatsApp message (the page with the full video). */
  WHATSAPP_VIDEO_URL: z.url().default("https://oficialacesso.site/video"),
  /** Business number, digits only — target of the wa.me fallback link. */
  WHATSAPP_BUSINESS_PHONE: z
    .string()
    .trim()
    .regex(/^\d{12,13}$/, { error: "WHATSAPP_BUSINESS_PHONE must be digits only, e.g. 5519981630656" })
    .default("5519981630656"),
});

const whatsappSchema = z.object({
  /** Public HTTPS URL of the self-hosted Evolution API, e.g. https://evolution.oficialacesso.site */
  EVOLUTION_BASE_URL: required("EVOLUTION_BASE_URL").pipe(
    z.url({ error: "EVOLUTION_BASE_URL must be a full URL, e.g. https://evolution.oficialacesso.site" }),
  ),
  /** Global key (server AUTHENTICATION_API_KEY): instance lifecycle + webhook config. */
  EVOLUTION_API_KEY: required("EVOLUTION_API_KEY"),
  EVOLUTION_INSTANCE_NAME: z.string().trim().min(1).default("sensitiva"),
  /** Instance-scoped token (returned when the instance is created): message sending. */
  EVOLUTION_INSTANCE_TOKEN: required("EVOLUTION_INSTANCE_TOKEN"),
  /** Random string we generate; it is the last path segment of the webhook URL. */
  EVOLUTION_WEBHOOK_SECRET: required("EVOLUTION_WEBHOOK_SECRET").pipe(
    z.string().min(32, { error: "EVOLUTION_WEBHOOK_SECRET must be at least 32 characters" }),
  ),
});

export type ServerEnv = z.infer<typeof coreSchema>;
export type WhatsAppEnv = z.infer<typeof whatsappSchema>;
export type WhatsAppConfig = { ok: true; env: WhatsAppEnv } | { ok: false; problems: string[] };

function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  return out;
}

let cachedCore: ServerEnv | undefined;
let cachedWhatsApp: WhatsAppConfig | undefined;

/** Core env. Throws one error listing every problem (the boot check calls this). */
export function getServerEnv(): ServerEnv {
  if (cachedCore) return cachedCore;
  const result = coreSchema.safeParse(blankToUndefined(process.env));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.message}`).join("\n");
    throw new Error(`Invalid server environment — fix .env (see .env.example):\n${problems}`);
  }
  cachedCore = result.data;
  return cachedCore;
}

/** WhatsApp (Evolution) env. Never throws: callers degrade when it's incomplete. */
export function getWhatsAppConfig(): WhatsAppConfig {
  if (cachedWhatsApp) return cachedWhatsApp;
  const result = whatsappSchema.safeParse(blankToUndefined(process.env));
  cachedWhatsApp = result.success
    ? { ok: true, env: result.data }
    : { ok: false, problems: result.error.issues.map((issue) => issue.message) };
  return cachedWhatsApp;
}
