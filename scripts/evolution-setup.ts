/**
 * npm run whatsapp:setup [-- --pair 5519981630656]
 *
 * Idempotent provisioning of the Evolution API instance:
 *   1. GET  /instance/fetchInstances  → reuse the instance if it exists
 *   2. POST /instance/create          → otherwise create it (Baileys, QR, webhook)
 *   3. POST /webhook/set/{instance}   → (re)apply the webhook config either way
 *   4. GET  /instance/connectionState → if not "open":
 *      GET  /instance/connect/{instance} → QR (saved as evolution-qr.png) or,
 *      with --pair <number>, an 8-character pairing code
 *   5. GET  /instance/connectionState → report "open" / "close"
 *
 * All lifecycle calls use the GLOBAL key (EVOLUTION_API_KEY). The instance
 * token is written to .env as EVOLUTION_INSTANCE_TOKEN and printed masked only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  connectInstance,
  connectionState,
  createInstance,
  EvolutionRequestError,
  fetchInstances,
  maskSecret,
  setWebhook,
  type EvolutionConnection,
} from "../src/lib/evolution.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on the real environment
}

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  console.error(`✗ Missing ${name} in .env — see .env.example and docs/WHATSAPP.md.`);
  process.exit(1);
}

/** Sets KEY="value" in .env (adds the line if missing). The value is never printed. */
function writeEnvValue(key: string, value: string): void {
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

function fail(step: string, error: unknown): never {
  if (error instanceof EvolutionRequestError) {
    const { httpStatus, reason } = error.error;
    console.error(`✗ ${step} failed: HTTP ${httpStatus} — ${reason}`);
    if (httpStatus === 401) console.error("  401 = wrong key tier. Lifecycle calls need the GLOBAL key (EVOLUTION_API_KEY).");
    if (httpStatus === 404) console.error("  404 = instance not found on this server.");
    if (httpStatus === 0) console.error("  Could not reach EVOLUTION_BASE_URL — is the stack up and the proxy serving HTTPS?");
  } else {
    console.error(`✗ ${step} failed:`, error instanceof Error ? error.message : error);
  }
  process.exit(1);
}

const baseUrl = env("EVOLUTION_BASE_URL");
const instanceName = env("EVOLUTION_INSTANCE_NAME", "sensitiva");
const webhookSecret = env("EVOLUTION_WEBHOOK_SECRET");
const appUrl = env("APP_URL", "https://oficialacesso.site").replace(/\/+$/, "");
const webhookUrl = `${appUrl}/api/whatsapp/webhook/${webhookSecret}`;
// Global key: create / list / connect / connectionState / webhook config.
const globalKey: EvolutionConnection = { baseUrl, apiKey: env("EVOLUTION_API_KEY") };

const pairIndex = process.argv.indexOf("--pair");
const pairNumber = pairIndex > -1 ? (process.argv[pairIndex + 1] ?? "").replace(/\D/g, "") : "";

console.log(`Evolution API: ${baseUrl}  ·  global key ${maskSecret(globalKey.apiKey)}  ·  instance "${instanceName}"`);

// 1. Existing instance?
let instances;
try {
  instances = await fetchInstances(globalKey);
} catch (error) {
  fail("fetchInstances", error);
}
const existing = instances.find((i) => i.name === instanceName);

if (existing) {
  console.log(`✓ Instance exists — name: ${existing.name}  id: ${existing.id ?? "?"}  status: ${existing.connectionStatus ?? "?"}  token: ${maskSecret(existing.token)}`);
  if (existing.token && process.env.EVOLUTION_INSTANCE_TOKEN?.trim() !== existing.token) {
    writeEnvValue("EVOLUTION_INSTANCE_TOKEN", existing.token);
    console.log("  Instance token written to .env (EVOLUTION_INSTANCE_TOKEN).");
  }
} else {
  // 2. Create it.
  let created;
  try {
    created = await createInstance(globalKey, { instanceName, webhookUrl });
  } catch (error) {
    fail("createInstance", error);
  }
  console.log(`✓ Instance created — name: ${created.name}  id: ${created.id ?? "?"}  token: ${maskSecret(created.token)}`);
  if (created.token) {
    writeEnvValue("EVOLUTION_INSTANCE_TOKEN", created.token);
    console.log("  Instance token written to .env (EVOLUTION_INSTANCE_TOKEN). Copy it to the production env too.");
  } else {
    console.log("  ⚠ No token in the response — run this command again to read it from fetchInstances.");
  }
}

// 3. Webhook (idempotent: set overwrites the config).
try {
  await setWebhook(globalKey, instanceName, webhookUrl);
  console.log(`✓ Webhook set → ${appUrl}/api/whatsapp/webhook/${maskSecret(webhookSecret)}  (byEvents: false)`);
} catch (error) {
  fail("webhook/set", error);
}

// 4. Link the phone if needed.
let state: string | null = null;
try {
  state = await connectionState(globalKey, instanceName);
} catch (error) {
  fail("connectionState", error);
}

if (state === "open") {
  console.log("✓ WhatsApp already linked (state: open). Nothing to scan.");
  process.exit(0);
}

try {
  const qr = await connectInstance(globalKey, instanceName, pairNumber || undefined);
  if (qr.pairingCode) {
    console.log(`\n📱 Pairing code: ${qr.pairingCode}`);
    console.log("   On the phone: WhatsApp Business → Dispositivos conectados → Conectar dispositivo →");
    console.log("   \"Conectar com número de telefone\" and type the code.");
  }
  if (qr.base64?.startsWith("data:image/png;base64,")) {
    writeFileSync("evolution-qr.png", Buffer.from(qr.base64.split(",")[1] ?? "", "base64"));
    console.log("\n📷 QR code saved to evolution-qr.png — open it and scan with the phone:");
    console.log("   WhatsApp Business → Dispositivos conectados → Conectar dispositivo.");
  } else if (qr.code) {
    console.log(`\n📷 QR payload (paste into any QR generator): ${qr.code}`);
  }
  if (!qr.pairingCode && !qr.base64 && !qr.code) {
    console.log("⚠ No QR returned. The instance may still be starting — run the command again in a few seconds.");
  }
  console.log("   The QR expires in about 40 seconds. If it does, just run this command again.");
} catch (error) {
  fail("connect", error);
}

// 5. Report the state after giving the owner a moment to scan.
console.log("\nWaiting 45 s for the scan…");
await new Promise((resolve) => setTimeout(resolve, 45_000));
try {
  state = await connectionState(globalKey, instanceName);
} catch (error) {
  fail("connectionState", error);
}
if (state === "open") {
  console.log("✓ Connected (state: open). WhatsApp is ready to send.");
} else {
  console.log(`✗ Not connected (state: ${state ?? "unknown"}). Scan again: run npm run whatsapp:setup.`);
  process.exitCode = 1;
}
