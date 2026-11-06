/**
 * In-memory sliding-window rate limiter (no Redis). Correct for a single
 * Node process, which is how the app runs on Hostinger. With several
 * processes/instances each one would keep its own window.
 */
const hits = new Map<string, number[]>();
let lastSweep = Date.now();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  // Occasional sweep so idle keys don't accumulate forever.
  if (now - lastSweep > windowMs * 5) {
    for (const [k, list] of hits) if (list.every((t) => now - t >= windowMs)) hits.delete(k);
    lastSweep = now;
  }

  if (recent.length >= limit) {
    hits.set(key, recent);
    const retryAfterSec = Math.ceil((windowMs - (now - (recent[0] ?? now))) / 1000);
    return { allowed: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSec: 0 };
}

/** Best-effort client IP behind Hostinger's proxy. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}
