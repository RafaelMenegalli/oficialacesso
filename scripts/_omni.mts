/**
 * Shared bits for the operator scripts (run with plain `node`, Node ≥ 22.6
 * strips the types). Kept separate from src/ so scripts need no bundler.
 * Never prints secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";

try {
  process.loadEnvFile(".env");
} catch {
  // Rely on the real environment.
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  console.error(`Missing ${name} in .env — see .env.example and docs/WHATSAPP.md.`);
  process.exit(1);
}

export async function omni(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const base = env("ZAPI_BASE_URL", "https://api.omni.z-api.io");
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: {
      Authorization: `Bearer ${env("ZAPI_SECRET_KEY")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // empty / non-JSON
  }
  return { status: response.status, body };
}

/** Error summary without echoing the full provider payload. */
export function describeError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const r = body as Record<string, unknown>;
    const code = r.subCode ?? r.code ?? r.error;
    const message = typeof r.message === "string" ? r.message : "";
    return `HTTP ${status} ${code ?? ""} ${message}`.trim();
  }
  return `HTTP ${status}`;
}

/** Sets KEY="value" in .env (adds the line if missing). The value is not printed. */
export function writeEnvValue(key: string, value: string): void {
  let text = "";
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    // new file
  }
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(".env", text);
}
