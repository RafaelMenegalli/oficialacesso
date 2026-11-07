import { z } from "zod";

/**
 * Server environment, validated once. Empty strings count as missing so a
 * half-filled .env fails loudly instead of sending requests with "" creds.
 *
 * Note on naming: CoEX runs on Omni Z-API (the official-API product), which
 * authenticates with a Bearer Secret Key — there is no Client-Token header and
 * no instance token in the path. See docs/WHATSAPP.md.
 */
const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, { error: `${name} is required` });

const serverEnvSchema = z.object({
  DATABASE_URL: required("DATABASE_URL"),

  ZAPI_BASE_URL: z.url().default("https://api.omni.z-api.io"),
  /** Omni Z-API Secret Key (panel → Segurança). Sent as `Authorization: Bearer`. */
  ZAPI_SECRET_KEY: required("ZAPI_SECRET_KEY"),
  /** Channel (formerly "instance") id of the CoEX WhatsApp number. */
  ZAPI_CHANNEL_ID: required("ZAPI_CHANNEL_ID"),
  /** WhatsApp Business Account id; templates are scoped to it. */
  ZAPI_WABA_ID: required("ZAPI_WABA_ID"),
  /** Random string we generate; the webhook must present it. */
  ZAPI_WEBHOOK_SECRET: required("ZAPI_WEBHOOK_SECRET").pipe(
    z.string().min(32, { error: "ZAPI_WEBHOOK_SECRET must be at least 32 characters" }),
  ),
  /** HMAC secret returned once when the webhook is created with signing: true. */
  ZAPI_WEBHOOK_SIGNING_SECRET: z.string().trim().optional(),

  WHATSAPP_TEMPLATE_NAME: z.string().trim().min(1).default("simpatia_acesso_imediato"),
  WHATSAPP_TEMPLATE_LANG: z.string().trim().min(1).default("pt_BR"),
  /** Business number, digits only — used for the wa.me fallback link. */
  WHATSAPP_BUSINESS_PHONE: z
    .string()
    .trim()
    .regex(/^\d{12,13}$/, { error: "WHATSAPP_BUSINESS_PHONE must be digits only, e.g. 5519981630656" })
    .default("5519981630656"),
  NEXT_PUBLIC_VSL_URL: z.url().default("https://oficialacesso.site/vsl"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  return out;
}

/** Returns the validated env or throws one error listing every problem. Never echoes values. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse(blankToUndefined(process.env));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.message}`).join("\n");
    throw new Error(
      `Invalid server environment — fix .env (see .env.example and docs/WHATSAPP.md):\n${problems}`,
    );
  }
  cached = result.data;
  return cached;
}
