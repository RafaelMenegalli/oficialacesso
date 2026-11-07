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
cp .env.example .env        # then fill DATABASE_URL + the EVOLUTION_* values
npm run db:migrate          # apply migrations
npm run dev                 # http://localhost:3000 → redirects to /vsl
```

```bash
npm run build && npm start  # production build + server
npm run db:deploy           # apply migrations in production
npm run whatsapp:setup      # create/link the Evolution instance and register the webhook
```

Startup checks the environment in two tiers:
- **Core** (`DATABASE_URL`): if it's missing, the server **refuses to start** and lists the
  problem.
- **WhatsApp** (`EVOLUTION_*`): if it's missing, a highlighted error is logged at startup, but the
  site stays up. Leads are saved and get the wa.me fallback link, but no message is sent.

Deploys are automatic on push to `main`, so an incomplete WhatsApp setup never takes the VSL down.

WhatsApp messages go through a self-hosted **Evolution API** (Baileys). It runs on a VPS from
`docker-compose.evolution.yml`. Read [`docs/WHATSAPP.md`](docs/WHATSAPP.md), including the
**ban-risk** section, before going live.

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
| `EVOLUTION_BASE_URL` | HTTPS URL of the Evolution API server. |
| `EVOLUTION_API_KEY` | Global key: instance lifecycle and webhook config. |
| `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_INSTANCE_TOKEN` | The instance and its token, used for sending. |
| `EVOLUTION_WEBHOOK_SECRET` | Secret path segment of the webhook URL. |
| `APP_URL` | Public URL of this app, used by the setup script for the webhook URL. |
| `WHATSAPP_VIDEO_URL` | Link sent in the WhatsApp message (default `https://oficialacesso.site/video`). |
| `WHATSAPP_BUSINESS_PHONE` | Business number, used for the wa.me fallback link. |

The video locks at 10 seconds (`VSL_LOCK_AT_SECONDS` in `src/components/vsl/VslPlayer.tsx`).
See `docs/FUNNEL.md` for the funnel and `docs/WHATSAPP.md` for the WhatsApp integration.

## Editing testimonials

Edit `src/data/testimonials.ts`. Each entry has `name`, `text`, `likes` and optional `replies`.
The markup updates automatically.
