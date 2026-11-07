/**
 * npm run whatsapp:webhook -- [public webhook URL]
 *
 * Registers this app's webhook on the CoEX channel through Omni Z-API:
 *   - payloadFormat Z_API (ReceivedCallback / MessageStatusCallback / …)
 *   - events: received, delivery, status, connected, disconnected
 *   - auth: header `x-webhook-secret: <ZAPI_WEBHOOK_SECRET>`
 *   - signing: true → the HMAC secret is returned ONCE and written straight
 *     into .env as ZAPI_WEBHOOK_SIGNING_SECRET (never printed).
 * Idempotent: if a webhook with the same URL exists, it is left untouched.
 *
 * Default URL: https://oficialacesso.site/api/whatsapp/webhook
 * Local test: pass your tunnel URL, e.g. https://xyz.trycloudflare.com/api/whatsapp/webhook
 */
import { describeError, env, omni, writeEnvValue } from "./_omni.mts";

const channelId = env("ZAPI_CHANNEL_ID");
const secret = env("ZAPI_WEBHOOK_SECRET");
const url = process.argv[2] ?? "https://oficialacesso.site/api/whatsapp/webhook";

const list = await omni(`/v1/channels/${encodeURIComponent(channelId)}/webhooks`);
if (list.status !== 200) {
  console.error(`Listing webhooks failed: ${describeError(list.status, list.body)}`);
  process.exit(1);
}
const existing = (list.body as { id?: string; url?: string; status?: string; payloadFormat?: string }[]).find(
  (w) => w.url === url,
);
if (existing) {
  console.log(`Webhook already registered for ${url}`);
  console.log(`  id: ${existing.id ?? "?"}  status: ${existing.status ?? "?"}  format: ${existing.payloadFormat ?? "?"}`);
  console.log("To rotate secrets, delete it in the panel and run this again.");
  process.exit(0);
}

const created = await omni(`/v1/channels/${encodeURIComponent(channelId)}/webhooks`, {
  method: "POST",
  body: JSON.stringify({
    url,
    description: "Sensitiva VSL leads",
    events: ["MESSAGE_RECEIVED", "MESSAGE_DELIVERY", "MESSAGE_STATUS", "CONNECTED", "DISCONNECTED"],
    payloadFormat: "Z_API",
    signing: true,
    auth: { type: "CUSTOM_HEADER", headerName: "x-webhook-secret", headerValue: secret },
  }),
});
if (created.status !== 200 && created.status !== 201) {
  console.error(`Webhook creation failed: ${describeError(created.status, created.body)}`);
  process.exit(1);
}
const body = created.body as { id?: string; secret?: string };
if (body.secret) {
  writeEnvValue("ZAPI_WEBHOOK_SIGNING_SECRET", body.secret);
  console.log("HMAC signing secret saved to .env (ZAPI_WEBHOOK_SIGNING_SECRET). Copy it to the production env too.");
}
console.log(`Webhook created. id: ${body.id ?? "?"} → ${url}`);
