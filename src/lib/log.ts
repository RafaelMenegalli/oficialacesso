/**
 * Minimal structured logger: one JSON object per line on stdout/stderr.
 *
 * Privacy rules (LGPD):
 * - never pass full phone numbers — use maskPhone();
 * - message bodies / names only at `debug`, which is off unless LOG_LEVEL=debug;
 * - never pass secrets, tokens or raw provider payloads.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  return ORDER[configured ?? "info"] ?? ORDER.info;
}

function write(level: Level, event: string, fields: Fields = {}) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

/** "+5519981630656" → "+5519*****0656". Works with or without the plus. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `+${digits.slice(0, 4)}${"*".repeat(Math.max(digits.length - 8, 3))}${digits.slice(-4)}`;
}
