# Funnel

```
/vsl ──(video reaches 5 s)──▶ locked modal: name + WhatsApp + consent
                                    │  POST /api/leads
                                    ▼
                    Lead saved (Postgres) ─▶ MARKETING template via Omni Z-API (CoEX)
                                    │            "Oii, {{1}}! …"  [Assistir agora → NEXT_PUBLIC_VSL_URL]
                                    ▼
                    POST /api/whatsapp/webhook ◀── delivery / read / replies
                                    │
                                    ▼
                               /pagven (sales page, later)
```

## Stages

| Stage | Status | Where |
| --- | --- | --- |
| `/vsl` video sales letter | Built | `src/app/vsl/page.tsx` |
| Pause + lock at 5 s | Built | `VSL_LOCK_AT_SECONDS` in `src/components/vsl/VslPlayer.tsx` |
| Lead-capture modal (with consent) | Built | `src/components/LeadCaptureModal.tsx` |
| Lead storage + template send | Built | `src/app/api/leads/route.ts`, `src/lib/zapi.ts` |
| Delivery/read tracking, replies | Built | `src/app/api/whatsapp/webhook/route.ts` |
| `/pagven` sales page | Placeholder ("Em breve") | `src/app/pagven/page.tsx` |

Details, setup and constraints of the WhatsApp part: [`docs/WHATSAPP.md`](WHATSAPP.md).

## How the lock behaves

- When the video reaches `VSL_LOCK_AT_SECONDS` (5), it pauses, leaves fullscreen and
  picture-in-picture, and opens the modal.
- **Seeking past the lock:** dragging the progress bar beyond 5 s locks immediately and
  rewinds to 5 s.
- **Resuming playback:** any play attempt while locked is undone (media keys, headset
  buttons, lock-screen controls).
- **Dismissing the modal:** it has no close button and ignores Escape. If the browser
  force-closes it anyway, it reopens. While it's open, the page behind can't be clicked
  or scrolled.
- **After the message is sent:** the modal shows "Pronto!" and closes after about 3.5 s. The video
  stays locked: the full video is delivered through the WhatsApp link.
- **If sending fails:** the modal stays open with the specific error, keeps what she typed and
  offers the wa.me fallback link.
- **Reload:** the lock is deliberately not saved. A reload starts the video from 0, plays
  5 s and locks again.

### Known limits (client-side lock)

- With JavaScript disabled, the video plays in full because the lock is JavaScript.
- The video file URL is public, so a technical visitor can open it directly. Real
  protection would need signed or expiring URLs from a video host (Bunny Stream,
  Cloudflare Stream, Mux).
