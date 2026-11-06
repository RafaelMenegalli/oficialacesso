/**
 * GET /api/health — operator diagnostic. Requires the webhook secret in the
 * `x-webhook-secret` header (or `?token=`), so infrastructure details are not
 * public. Never returns secrets, URLs or credentials: only which host kind the
 * database URL points at and error codes.
 */
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { verifyWebhookSecret } from "@/lib/zapi";

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["code", "errorCode"] as const) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
    const cause = record.cause;
    if (cause && typeof cause === "object" && typeof (cause as Record<string, unknown>).code === "string") {
      return (cause as Record<string, unknown>).code as string;
    }
    if (error instanceof Error) return error.name;
  }
  return "unknown";
}

/** "localhost" | "private" | "remote" — enough to spot a copied local URL. */
function databaseHostKind(url: string): string {
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
  const report: Record<string, string | number | boolean> = {
    databaseHost: databaseHostKind(env.DATABASE_URL),
    webhookSigning: Boolean(env.ZAPI_WEBHOOK_SIGNING_SECRET),
  };

  try {
    await getDb().$queryRaw`SELECT 1`;
    report.dbConnection = "ok";
  } catch (error) {
    report.dbConnection = errorCode(error);
    return Response.json(report, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    report.leads = await getDb().lead.count();
    report.dbTables = "ok";
  } catch (error) {
    report.dbTables = errorCode(error); // P2021 = table missing → run `npm run db:deploy`
  }

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
