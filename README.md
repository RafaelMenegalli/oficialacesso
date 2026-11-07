# Sensitiva funnel

Next.js 16 (App Router, TypeScript) + Tailwind CSS v4.

| Route | What it is |
| --- | --- |
| `/` | Redirects (307) to `/vsl` |
| `/vsl` | Video sales letter: background, headline, video, testimonials, footer |
| `/pagven` | Placeholder ("Em breve"). The sales page comes in a later task |

See [`docs/FUNNEL.md`](docs/FUNNEL.md) for the full funnel and where future pieces plug in.

## Running locally

```bash
npm install                 # also generates the Prisma client
npm run db:dev              # local Postgres (Prisma Dev) in the background; prints the URLs
cp .env.example .env        # then fill DATABASE_URL + the Omni Z-API values
npm run db:migrate          # apply migrations
npm run dev                 # http://localhost:3000 → redirects to /vsl
```

```bash
npm run build && npm start  # production build + server
npm run db:deploy           # apply migrations in production
npm run whatsapp:template   # create / check the WhatsApp template
npm run whatsapp:webhook    # register the webhook (pass a tunnel URL for local tests)
```

The server **refuses to start** if a required variable is missing and lists each one. That
includes the Omni Z-API credentials, so fill them in before `npm run dev`.

## Assets

Drop files into `public/assets/` with these exact names:

| File | Used for | If missing |
| --- | --- | --- |
| `vsl-background.jpg` | Full-screen background (shown grayscale and darkened) | Dark gradient only |
| `vsl-video.mp4` | The VSL (unless `NEXT_PUBLIC_VSL_VIDEO_URL` is set) | Player shows an error |
| `vsl-cover.jpg` | Video cover behind the play button, 16:9 | Fallback order: `vsl-cover.jpg` → `vsl-poster.jpg` → `vsl-background.jpg` → CSS gradient cover |
| `vsl-poster.jpg` | Second choice for the video cover | See above |

Missing files are detected when the page is built. After adding an asset, restart `npm run dev` or rebuild.

`design/testimonials-reference.png` is the design reference for the testimonials section. It sits
outside `public/` on purpose, so it is never served to visitors.

### About the video file

`vsl-video.mp4` is about 148 MB. That works locally, but for production:

- Host it on a video CDN or object storage (Bunny Stream, Cloudflare R2/Stream, S3 + CloudFront)
  and set `NEXT_PUBLIC_VSL_VIDEO_URL`. Most hosts (Vercel included) are not built to serve large
  files from `public/`, and GitHub rejects files over 100 MB, so the file is git-ignored.
- Re-encode it for the web (H.264, about 1.5–2.5 Mbps at 720p, `-movflags +faststart`). This
  makes it much smaller and lets playback start before the whole file downloads.

## Environment variables

Every variable is listed with a one-line comment in [`.env.example`](.env.example). In short:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_VSL_VIDEO_URL` | Optional remote video URL. Takes priority over `/assets/vsl-video.mp4`. |
| `DATABASE_URL` | PostgreSQL connection string (leads + message log). |
| `ZAPI_SECRET_KEY`, `ZAPI_CHANNEL_ID`, `ZAPI_WABA_ID` | Omni Z-API credentials for the CoEX number. |
| `ZAPI_WEBHOOK_SECRET`, `ZAPI_WEBHOOK_SIGNING_SECRET` | Webhook authentication. |
| `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | The approved template. |
| `NEXT_PUBLIC_VSL_URL` | Link in the template's button. |

The video locks at 10 seconds (`VSL_LOCK_AT_SECONDS` in `src/components/vsl/VslPlayer.tsx`).
See `docs/FUNNEL.md` for the funnel and `docs/WHATSAPP.md` for the WhatsApp integration.

## Editing testimonials

Edit `src/data/testimonials.ts`. Each entry has `name`, `text`, `likes` and optional `replies`.
The markup updates automatically.
