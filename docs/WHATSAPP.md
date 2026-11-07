# WhatsApp delivery (Omni Z-API, CoEX)

The lead modal on `/vsl` collects name, phone and consent. The server then sends
**one** approved Meta template to the lead through **Omni Z-API**.

```
modal ─POST /api/leads─▶ validate + consent + upsert Lead ─▶ template approved? ─▶ send template
                                                                     │ no / send fails
                                                                     ▼
                                                     status "failed" + wa.me fallback link
Omni Z-API ─POST /api/whatsapp/webhook─▶ statuses (sent → delivered → read), inbound replies, connection events
```

## Why Omni Z-API

CoEX (Coexistence) is Meta's official mode: one number works in the **WhatsApp Business app**
and in the **Cloud API** at the same time. The owner keeps chatting manually on +55 19 98163-0656
while the API sends the automated message.

At Z-API, CoEX is not part of the classic product (`api.z-api.io`, QR-code instances, `Client-Token`).
It runs on **Omni Z-API**, a separate product with its own panel (`app.omni.z-api.io`) and its own API.
This was verified in the docs on 2026-11-06:

| | Classic Z-API (QR-code) | Omni Z-API (official / CoEX), used here |
| - | - | - |
| Panel | app.z-api.io | app.omni.z-api.io |
| Base URL | `https://api.z-api.io` | `https://api.omni.z-api.io` |
| Auth | `Client-Token` header + instance token in the path | `Authorization: Bearer <Secret Key>` |
| Id | instance id | channel id (+ WABA id for templates) |
| Templates | not applicable | `POST /v1/channels/{channelId}/messages` with `content.type: TEMPLATE` |

That's why the env vars are `ZAPI_SECRET_KEY` / `ZAPI_CHANNEL_ID` / `ZAPI_WABA_ID` instead of the
`ZAPI_TOKEN` / `ZAPI_CLIENT_TOKEN` / `ZAPI_INSTANCE_ID` used by the classic product.

### CoEX constraints (not worked around)

- **Business-initiated messages need an approved template.** Free text to someone who never wrote
  to the number is rejected. The first message is a **MARKETING** template.
- **Cost:** R$ 0,3217 per *delivered* MARKETING message to a Brazilian number (Meta rate card in
  force since 1 Oct 2026). Undelivered messages are not charged. Messages the owner sends by hand
  from the app are free. Only API traffic is billed. A payment method must be set up in Meta.
- **Throughput:** capped at 20 messages/second. That's irrelevant at one message per lead, but it rules out bulk sends.
- **Open the WhatsApp Business app at least every 14 days.** Otherwise Meta unlinks the API.
  Omni's docs say 15 days; 14 leaves a margin. A disconnect shows up as `DisconnectedCallback` in
  the logs (`whatsapp.disconnected`), and sends fail with `CHANNEL_DISCONNECTED`.
- **WhatsApp Desktop for Windows stops working** with a CoEX number. Linked devices are logged out
  at connection and can be re-linked.
- **No green "Official Business Account" badge** on CoEX numbers. Not attempted.

## The template

Defined in `scripts/create-template.mts`:

| Field | Value |
| - | - |
| Name | `simpatia_acesso_imediato` (`WHATSAPP_TEMPLATE_NAME`) |
| Category | `MARKETING` |
| Language | `pt_BR` |
| Body | `Oii, {{1}}! Tudo bem? Segue o link para assistir ao vídeo completo.` (`{{1}}` = first name, example "Maria") |
| Footer | `Equipe Sensitiva` |
| Button | URL, label `Assistir agora`, static target `NEXT_PUBLIC_VSL_URL` |

**Why the link is in the button, not the body:**
- The body stays short and personal.
- The tap target is unambiguous: one big button, no tiny link in the text.
- Meta's link-preview rewriting inside template bodies is avoided.
- A static URL means the button needs **no parameter at send time**: only `{{1}}` is sent.

The template is text-only: no header and no media.

### Create it

Option A, via API (Omni exposes template creation):

```bash
npm run whatsapp:template
```

The command is idempotent. If a template with the same name and language exists, it prints its
id and status. Otherwise it creates the template and prints `PENDING`. Run it again to see the
status change to `APPROVED` (usually minutes, up to 24 h).

Option B, in the panel. The menu labels below come from the docs and weren't checked in the live
panel, so they may differ slightly. In **app.omni.z-api.io → Templates → Novo template**, choose
**Mensagem customizada**, then fill in:
- **WABA:** the CoEX number's WABA
- **Nome:** `simpatia_acesso_imediato`
- **Categoria:** Marketing
- **Idioma:** Português (BR)
- **Corpo:** the text above, with example `Maria` for `{{1}}`
- **Rodapé:** `Equipe Sensitiva`
- **Botão:** Link, label `Assistir agora`, URL `https://oficialacesso.site/vsl`

Submit, and wait for **Aprovado**. If you change the name or language, update `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG`.

Before the first send in each server process, the app checks that the template is `APPROVED`
(`GET /whatsapp/businesses/{wabaId}/templates`) and caches a positive answer for the life of the
process. If it's pending or rejected, the lead is marked `failed` with `replyError=template_pending`
(or `template_rejected` / `template_not_found`). An `error` log names the fix, and the visitor gets the
fallback link.

## The webhook

Register it once per environment:

```bash
npm run whatsapp:webhook                     # https://oficialacesso.site/api/whatsapp/webhook
npm run whatsapp:webhook -- https://<tunnel>/api/whatsapp/webhook
```

The script creates a channel webhook with:
- `payloadFormat: Z_API`, so callbacks arrive as `ReceivedCallback`, `MessageStatusCallback`, `DeliveryCallback`, `ConnectedCallback` and `DisconnectedCallback`
- events `MESSAGE_RECEIVED`, `MESSAGE_DELIVERY`, `MESSAGE_STATUS`, `CONNECTED`, `DISCONNECTED`
- auth `CUSTOM_HEADER`: `x-webhook-secret: <ZAPI_WEBHOOK_SECRET>`
- `signing: true`. Omni returns an HMAC secret **once**, and the script writes it into `.env` as
  `ZAPI_WEBHOOK_SIGNING_SECRET` without printing it. Copy it to production too.

The same can be done in the panel (**Canais → canal → Webhooks → Novo**) with those settings.
In that case, paste the signing secret into the env yourself.

What the route does:
- **Checks the caller.** The secret must arrive in the `x-webhook-secret` header (or a `?token=`
  query) and is compared in constant time. If a signing secret is configured, the HMAC in
  `x-webhook-signature` is verified as well. A mismatch returns 401.
- **Acknowledges first.** It answers 200 right away and processes in `after()`, because Omni retries
  anything slower than 5 s or any non-2xx response.
- **Is idempotent.** Each handled event inserts a `MessageLog` row with a unique `providerMessageId`
  (message id, or `<id>:<STATUS>`). A replayed callback hits the unique key and changes nothing.
- **Inbound (`ReceivedCallback`):**
  - groups, `fromMe` echoes, newsletters and broadcasts are ignored;
  - the lead is matched by phone (with or without the 9th digit);
  - it records `firstInboundAt` and `lastInboundAt`; the 24 h service window runs from `lastInboundAt` (`isWindowOpen()`);
  - there is no auto-reply;
  - unknown numbers are logged with a masked phone and nothing else happens.
- **Statuses** advance the lead and never move it backwards (`sent → delivered → read`).
  `RECEIVED` means delivered. Errors in a `DeliveryCallback` mark the lead `failed` with the code.
- **`DisconnectedCallback`** logs `whatsapp.disconnected` at error level. It usually means the
  14-day app-open rule lapsed.

### Testing locally with a tunnel

1. Run `npm run db:dev`, `npm run dev`, then `npx cloudflared tunnel --url http://localhost:3000`
   (or ngrok).
2. Run `npm run whatsapp:webhook -- https://<tunnel-host>/api/whatsapp/webhook`.
3. Submit the modal with your own number, reply to the message, and watch the JSON logs.
4. Delete the tunnel webhook in the panel afterwards.

## Error codes

| Code | Meaning | What to do |
| - | - | - |
| `190` | Invalid or expired token | Confirm `ZAPI_SECRET_KEY` (Omni) and the channel connection |
| `131026` | Recipient can't receive messages (not on WhatsApp / invalid) | Nothing to fix on our side; she can use the fallback link |
| `132000` | Parameter count mismatch between template and send | The body must have exactly one variable; check the approved template |
| `132001` | Template doesn't exist or isn't approved in that language | Check `WHATSAPP_TEMPLATE_NAME` / `_LANG`; run `npm run whatsapp:template` |
| `131047` | Re-engagement required (free-form outside the 24 h window) | Not used here: we only send templates |
| `368` | Temporarily blocked for policy violations | Stop sending; review the template content and quality rating in Meta |
| `CHANNEL_DISCONNECTED` | Omni: channel not connected (422) | Open the WhatsApp Business app, reconnect the channel in the panel |
| `VALIDATION_ERROR` | Omni: malformed send body (400) | Bug: check the payload in `sendTemplate` |
| `template_pending` / `_rejected` / `_not_found` | Our pre-send check | Wait for approval or fix the template |
| `DisconnectedCallback` | CoEX link dropped | Open the WhatsApp Business app on the phone, then reconnect |

The numeric codes are Meta Graph codes. Omni's own errors use `code` / `subCode` strings. Whatever
the provider returns is stored in `Lead.replyError` and `MessageLog.errorCode`.

## Privacy

- **Logs** are JSON lines. Phones are masked (`+5519*****0656`). Names and message bodies appear
  only at `LOG_LEVEL=debug`. No secret or raw provider payload is ever logged.
- **Consent:** the modal requires an unticked-by-default checkbox, and the server rejects
  `consent !== true`. `consentAt` and `consentIp` are stored on the lead.
- **TODO (owner decision, LGPD):** how long leads are retained and how deletion requests are handled.

## Seams for later (not implemented)

Boleto events (generated, paid, cancelled) will need, in order:
1. A payment-gateway webhook route, e.g. `src/app/api/payments/webhook/route.ts`, with its own secret.
2. Matching the payer to `Lead` by phone (`normalizePhone`).
3. One new UTILITY template per event, sent with `sendTemplate`. Today it takes the name from env:
   add a `templateName` parameter when that lands.
4. Optional new `LeadStatus` values (`paid`, …) via a Prisma migration.

No bulk sends, sequences or bots are planned here; each would multiply the per-message cost above.
