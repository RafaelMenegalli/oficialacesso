# WhatsApp delivery (Evolution API, Baileys)

When a visitor fills in the lead modal on `/vsl` (name, WhatsApp number, consent), the server
sends **one** WhatsApp text to her through a self-hosted **Evolution API** instance:

```
modal ─POST /api/leads─▶ validate + consent + upsert Lead ─▶ POST /message/sendText ─▶ her WhatsApp
                                         │ send fails
                                         ▼
                              status "failed" + wa.me fallback link
Evolution ─POST /api/whatsapp/webhook/<secret>─▶ delivery/read updates, inbound replies, connection state
```

The message (built by `buildLeadMessage()` in `src/lib/evolution.ts`) is written to look like a
person typed it:

```
oii, é a Maria? se sim, aqui vai o link da página com o vídeo completo: https://oficialacesso.site/video
```

- The link comes from `WHATSAPP_VIDEO_URL` (default `https://oficialacesso.site/video`).
- The article before the name is picked by `articleFor()`, a deliberately simple rule:
  - `a` when the first name ends in "a" (Maria, Ana);
  - `a` for a list of common female names that don't end in "a" (Raquel, Beatriz, Ingrid…);
  - `a` for female endings (-ane, -ine, -ele, -ise, -ice, -ene, -ete: Aline, Daniele, Denise…);
  - `o` for everything else, and for male names ending in "a" (Luca, Joshua…).

  Unusual names can come out wrong. Add them to the lists in `src/lib/evolution.ts`.

## Why Evolution API

Evolution API in **Baileys** mode links to WhatsApp as a companion device (like WhatsApp Web),
using the owner's own number:
- **Free-form text right away.** It can message any number immediately, with no template to get
  approved first.
- **No per-message cost.** Meta doesn't bill this mode.
- **Self-hosted.** The instance, the session and the message data stay on our own server.

## ⚠️ Ban risk: read this first

**Baileys is unofficial.** It emulates a linked device, which goes against WhatsApp's Terms of
Service. Meta detects automation through volume, repetition and sender behaviour, and can
**restrict or ban the number** at any time, with no appeal. This risk was accepted knowingly.

What the code does to keep the risk low:
- **One message per lead.** A lead already in `sent`/`delivered`/`read` is never messaged again,
  and a per-phone lock prevents double sends. The only exception is the owner's own test numbers
  in `WHATSAPP_TEST_NUMBERS` (comma-separated), which can receive the message every time the form
  is submitted. Keep that list to your own numbers.
- **Opt-in only.** Sends happen only after she ticks the consent box, and the server rejects
  anything else.
- **Human-like send.** `delay: 1200` makes WhatsApp show "digitando…" for 1.2 s before sending.
- **No auto-replies, ever.**
- **IP rate limit** on the form: 5 requests per minute.

**TODO (owner):**
- **Keep volume low.** No bursts.
- **Warm the number up:** a few dozen messages a day at first, increasing slowly over weeks.
- **Keep using the number normally:** chat, reply, keep conversations two-way.
- **Never broadcast** or send to lists. If the number gets restricted, stop all sending
  immediately.

## The Docker stack

Evolution runs on a **VPS with Docker**, not on the Hostinger Node.js hosting, which can't run
containers. Everything is in `docker-compose.evolution.yml`:

| Service | Image | Role |
| - | - | - |
| `evolution-api` | `evoapicloud/evolution-api:v2.3.7` | The API. Not published to the internet. |
| `postgres` | `postgres:16.10-alpine` | Evolution's own storage (instances, messages). |
| `redis` | `redis:7.4.6-alpine` | Evolution's cache. |
| `caddy` | `caddy:2.10.2-alpine` | Reverse proxy. Only it publishes ports 80/443, and it gets a Let's Encrypt certificate. |

All four share one bridge network, data lives in named volumes, and every image tag is pinned.

```bash
# On the VPS, in a checkout of this repo:
cp .env.evolution.example .env.evolution     # fill AUTHENTICATION_API_KEY, POSTGRES_PASSWORD, EVOLUTION_DOMAIN
docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
docker compose -f docker-compose.evolution.yml logs -f evolution-api
```

Before starting, create an **A record** `evolution.oficialacesso.site` pointing at the VPS IP,
so Caddy can issue the certificate.

`AUTHENTICATION_API_KEY` is **required**. It is the **global key**, and the app stores the same
value as `EVOLUTION_API_KEY`.

## Two keys: don't mix them up

Evolution authenticates with a flat **`apikey`** header, never `Authorization: Bearer`. There
are two keys:

| Key | Env var (app) | Where it comes from | Used for |
| - | - | - | - |
| **Global key** | `EVOLUTION_API_KEY` | `AUTHENTICATION_API_KEY` on the server | Instance lifecycle (create, list, connect, delete, logout) and webhook config |
| **Instance token** | `EVOLUTION_INSTANCE_TOKEN` | Returned when the instance is created (`hash`) | Sending messages |

Every call site in `src/lib/evolution.ts` says which key it uses. A 401 almost always means the
wrong tier.

## Setup: `npm run whatsapp:setup`

Run it locally, with `.env` holding `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`,
`EVOLUTION_WEBHOOK_SECRET` and `APP_URL`. It's idempotent, so you can rerun it any time:

1. **Lists instances** (`GET /instance/fetchInstances`, global key). If `EVOLUTION_INSTANCE_NAME`
   exists, it prints name, id, status and a masked token, and skips creation.
2. **Creates the instance** otherwise (`POST /instance/create`, `integration: "WHATSAPP-BAILEYS"`,
   `qrcode: true`, webhook included). The token is **written to `.env`** as
   `EVOLUTION_INSTANCE_TOKEN` and printed only masked (`abcd…wxyz`).
3. **Sets the webhook** (`POST /webhook/set/{instance}`), see the next section.
4. **Links the phone** if the state isn't `open` (`GET /instance/connect/{instance}`):
   - the QR is saved as **`evolution-qr.png`** (git-ignored). Open it and scan from the phone:
     **WhatsApp Business → Dispositivos conectados → Conectar dispositivo**;
   - or run `npm run whatsapp:setup -- --pair 5519981630656` to get an **8-character pairing
     code** and choose "Conectar com número de telefone" on the phone.

   The QR expires in about **40 seconds**. If it does, just run the command again.
5. **Reports the state** (`GET /instance/connectionState/{instance}`). `open` means ready. `close`
   means it wasn't linked, so scan again.

After it runs, copy `EVOLUTION_INSTANCE_TOKEN` from `.env` to the Hostinger environment and
redeploy.

## The webhook

The setup script registers it with the **global key**:

```json
POST /webhook/set/sensitiva
{
  "webhook": {
    "enabled": true,
    "url": "https://oficialacesso.site/api/whatsapp/webhook/<EVOLUTION_WEBHOOK_SECRET>",
    "byEvents": false,
    "base64": false,
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "SEND_MESSAGE"]
  }
}
```

In Evolution **v2.3.7** the keys inside `webhook` are **`byEvents`** and **`base64`**. The names
`webhookByEvents`/`webhookBase64` are ignored by v2's `/webhook/set`, which was verified in the
source.
- `byEvents: false` keeps every event on one URL, which is simpler to validate. With `true`,
  Evolution appends the event name to the URL (`…/<secret>/messages-upsert`) and this route
  would no longer match.

**Security.** Evolution doesn't sign webhooks. Protection comes from:
- **the secret path segment:** the route compares it to `EVOLUTION_WEBHOOK_SECRET` with
  `crypto.timingSafeEqual` (both sides hashed) and returns **401 before reading the body**;
- **HTTPS end to end;**
- **optionally, an IP allow-list:** only the VPS IP may call `/api/whatsapp/webhook/*`, set in the
  Hostinger firewall or proxy.

Webhook bodies include the **instance token** in `apikey`, so the route never logs raw payloads.

**Behaviour:**
- **Fast acknowledgement.** The route answers 200 at once and processes in `after()`. Evolution
  retries non-2xx responses, with a 60 s timeout.
- **`messages.upsert`, `fromMe: true`:** an echo of our own send, or the owner typing in the app.
  It's ignored.
- **`messages.upsert`, `fromMe: false`:** an inbound message.
  - The lead is matched by phone from `key.remoteJid`, with or without the 9th digit. When WhatsApp
    uses an `@lid` identifier, the phone comes from `key.remoteJidAlt`/`senderPn`.
  - It sets `firstInboundAt` and stores the text from `message.conversation` or
    `message.extendedTextMessage.text`.
  - **No auto-reply.**
- **`messages.update`:** `SERVER_ACK` means sent, `DELIVERY_ACK` delivered, `READ`/`PLAYED` read,
  and `ERROR` failed. Status only moves forward. Both v2.3 (`keyId`/`status`) and older
  (`key.id`/`update.status`) shapes are accepted.
- **`connection.update`:** `open` logs `whatsapp.connected`; `close` logs `whatsapp.disconnected`
  as a **warning**, meaning the phone has to be rescanned.
- **`send.message`:** an echo of a send, logged at debug level.
- **Groups and broadcasts** (`@g.us`, `@broadcast`, `@newsletter`) and unknown events are ignored.
- **Unknown numbers:** logged with a masked phone and nothing else happens.
- **Idempotency:** each handled event inserts a `MessageLog` row whose `waMessageId` is unique
  (the message id, or `<id>:<STATUS>`). A replayed callback hits the constraint and changes
  nothing.

## Testing locally with a tunnel

1. Run `npm run db:dev`, then `npm run dev`.
2. Expose the app: `npx cloudflared tunnel --url http://localhost:3000` (or ngrok).
3. Set `APP_URL=https://<tunnel-host>` in `.env` and run `npm run whatsapp:setup`. This points the
   webhook at the tunnel.
4. Submit the modal with your own number, reply from the phone, and watch the JSON logs.
5. Set `APP_URL` back to `https://oficialacesso.site` and run `npm run whatsapp:setup` again.

## When WhatsApp isn't configured

Production deploys automatically on every push to `main`, so a missing `EVOLUTION_*` variable must
not take the site down. Startup checks in two tiers (`src/lib/env.ts`):
- **Core** (`DATABASE_URL`) missing: the server refuses to start.
- **WhatsApp** (`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_TOKEN`,
  `EVOLUTION_WEBHOOK_SECRET`) incomplete: startup logs
  `████ WHATSAPP NOT CONFIGURED ████` listing what's missing, and the site keeps running:
  - `/vsl` works normally;
  - `/api/leads` saves the lead (`status: failed`, `replyError: 0:not_configured`) and returns the
    wa.me fallback link;
  - the webhook rejects every call while `EVOLUTION_WEBHOOK_SECRET` isn't set.

Leads saved in this state get their message only if they submit again after WhatsApp is configured.

## Diagnostics

`GET /api/health` with header `x-webhook-secret: <EVOLUTION_WEBHOOK_SECRET>` returns:
- `databaseHost` and `dbConnection`;
- `whatsapp`: the instance state (`open` when ready), or `not_configured`.

It answers as soon as the secret is set, even before the Evolution server exists.

## Errors

| Error | Meaning | What to do |
| - | - | - |
| `401` | Wrong key tier | Global key for instance operations, instance token for sends |
| `404` | Instance name doesn't exist | Run `npm run whatsapp:setup` |
| `Connection Closed` | The linked device dropped | Rescan the QR (`npm run whatsapp:setup`) |
| `not-authorized` / `not-on-whatsapp` | The number isn't on WhatsApp or is malformed | She gets the fallback link; nothing to fix on our side |
| `rate-overlimit` | Too many sends too fast | Slow down; warm the number up |
| `500` with a Baileys stack trace | Usually a stale session | Log the instance out and reconnect (`DELETE /instance/logout/{instance}`, then setup) |
| `timeout` / `network_error` | Evolution unreachable | Check the VPS, Caddy and the DNS record |

`Lead.replyError` stores `<http status>:<reason>`, with digits in provider messages masked.

## Privacy

- **Logs** are JSON lines. Phones are masked (`+5519*****0656`). Names and message bodies appear
  only at `LOG_LEVEL=debug`. No key, token or raw payload is ever logged.
- **Consent:** the modal requires an unticked-by-default checkbox, and the server rejects
  `consent !== true`. `consentAt` and `consentIp` are stored on the lead.
- **TODO (owner decision, LGPD):** retention period for leads and messages, both in the app
  database and in Evolution's own Postgres, and how deletion requests are handled.

## Seams for later (not implemented)

Boleto events (generated, paid, cancelled) will need:
1. A payment-gateway webhook route, e.g. `src/app/api/payments/webhook/route.ts`, with its own secret.
2. Matching the payer to `Lead` by phone (`normalizePhone`).
3. A message builder next to `buildLeadMessage()` per event, sent with `sendText()`, and subject
   to the same low-volume rules above.
4. Optional new `LeadStatus` values (`paid`, …) via a Prisma migration.
