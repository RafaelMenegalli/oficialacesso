/**
 * Runs once when a Next.js server instance starts, before it serves requests.
 * - Core env missing → throw: the server refuses to start, with a clear list.
 * - WhatsApp (Evolution) env missing → loud error, but the site stays up
 *   (see src/lib/env.ts for why).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` also loads this file; the real environment only exists at runtime.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { getServerEnv, getWhatsAppConfig } = await import("@/lib/env");
  getServerEnv();

  const whatsapp = getWhatsAppConfig();
  if (!whatsapp.ok) {
    console.error(
      [
        "",
        "████ WHATSAPP NOT CONFIGURED — leads are saved but NO message is sent ████",
        ...whatsapp.problems.map((problem) => `  - ${problem}`),
        "  Fix: set the EVOLUTION_* variables (see .env.example and docs/WHATSAPP.md), then restart.",
        "",
      ].join("\n"),
    );
  }
}
