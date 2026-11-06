import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Server-only helper: returns true when a file exists under /public.
 * Lets pages fall back to CSS placeholders instead of rendering broken
 * media when the owner has not dropped an asset in yet.
 *
 * @param publicPath - URL path as served, e.g. "/assets/vsl-poster.jpg"
 */
export function hasPublicAsset(publicPath: string): boolean {
  return existsSync(path.join(/* turbopackIgnore: true */ process.cwd(), "public", publicPath));
}

export const ASSETS = {
  background: "/assets/vsl-background.jpg",
  video: "/assets/vsl-video.mp4",
  poster: "/assets/vsl-poster.jpg",
  cover: "/assets/vsl-cover.jpg",
} as const;

/**
 * Video cover image, first existing of:
 * vsl-cover.jpg → vsl-poster.jpg → vsl-background.jpg.
 * Returns undefined when none exist (the cover falls back to a CSS gradient).
 */
export function resolveCoverImage(): string | undefined {
  return [ASSETS.cover, ASSETS.poster, ASSETS.background].find(hasPublicAsset);
}

/**
 * Video source resolution order:
 * 1. NEXT_PUBLIC_VSL_VIDEO_URL (e.g. a CDN / Bunny / S3 URL) when set
 * 2. the local file at /public/assets/vsl-video.mp4
 */
export function resolveVideoSrc(): string {
  const remote = process.env.NEXT_PUBLIC_VSL_VIDEO_URL?.trim();
  return remote ? remote : ASSETS.video;
}
