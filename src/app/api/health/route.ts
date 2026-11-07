/**
 * GET /api/health — operator diagnostic. Requires the webhook secret in the
 * `x-webhook-secret` header (or `?token=`), so infrastructure details are not
 * public. Never returns secrets or URLs: only host kind, states and error codes.
 */
import { getDb } from "@/lib/db";
import { getServerEnv, getWhatsAppConfig } from "@/lib/env";
import { connectionState, EvolutionRequestError, verifyWebhookSecret } from "@/lib/evolution";

function errorCode(error: unknown): string {
  if (error instanceof EvolutionRequestError) return `${error.error.httpStatus}:${error.error.reason}`;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.code === "string" && record.code) return record.code;
    const cause = record.cause;
    if (cause && typeof cause === "object" && typeof (cause as Record<string, unknown>).code === "string") {
      return (cause as Record<string, unknown>).code as string;
    }
    if (error instanceof Error) return error.name;
  }
  return "unknown";
}

/** "localhost" | "private" | "remote" — enough to spot a copied local URL. */
function hostKind(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "localhost";
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return "private";
    return "remote";
  } catch {
    return "unparseable";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provided = request.headers.get("x-webhook-secret") ?? url.searchParams.get("token");
  if (!verifyWebhookSecret(provided)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const env = getServerEnv();
  const report: Record<string, string | number | null> = { databaseHost: hostKind(env.DATABASE_URL) };

  try {
    await getDb().$queryRaw`SELECT 1`;
    report.dbConnection = "ok";
    report.leads = await getDb().lead.count();
  } catch (error) {
    report.dbConnection = errorCode(error); // P2021 = table missing → run `npm run db:deploy`
  }

  const whatsapp = getWhatsAppConfig();
  if (!whatsapp.ok) {
    report.whatsapp = "not_configured";
  } else {
    try {
      // Global key: connectionState is an instance lifecycle endpoint.
      report.whatsapp = await connectionState(
        { baseUrl: whatsapp.env.EVOLUTION_BASE_URL, apiKey: whatsapp.env.EVOLUTION_API_KEY },
        whatsapp.env.EVOLUTION_INSTANCE_NAME,
      );
    } catch (error) {
      report.whatsapp = errorCode(error);
    }
  }

  const healthy = report.dbConnection === "ok" && report.whatsapp === "open";
  return Response.json(report, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
