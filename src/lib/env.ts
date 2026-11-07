import { z } from "zod";

/**
 * Server environment, validated once (at boot via src/instrumentation.ts).
 * Empty strings count as missing so a half-filled .env fails loudly instead
 * of sending requests with "" credentials.
 */
const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, { error: `${name} is required` });

const serverEnvSchema = z.object({
  DATABASE_URL: required("DATABASE_URL"),

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

  /** Link placed in the WhatsApp message. */
  NEXT_PUBLIC_VSL_URL: z.url().default("https://oficialacesso.site/vsl"),
  /** Business number, digits only — target of the wa.me fallback link. */
  WHATSAPP_BUSINESS_PHONE: z
    .string()
    .trim()
    .regex(/^\d{12,13}$/, { error: "WHATSAPP_BUSINESS_PHONE must be digits only, e.g. 5519981630656" })
    .default("5519981630656"),
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
