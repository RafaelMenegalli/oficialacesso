/**
 * Runs once when a Next.js server instance starts, before it serves requests.
 * Validating here makes a missing credential crash the boot with a clear
 * message instead of failing silently on the first lead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` also loads this file; the real environment only exists at runtime.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { getServerEnv } = await import("@/lib/env");
  getServerEnv();
}
