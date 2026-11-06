import { cacheLife } from "next/cache";

/**
 * Current year for the footer. Cache Components forbids reading the clock in
 * the prerendered shell, so the value is cached and refreshed daily — the
 * page stays static and works without JavaScript.
 */
export async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return <>{new Date().getFullYear()}</>;
}
