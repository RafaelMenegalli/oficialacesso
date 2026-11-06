import { defineConfig } from "prisma/config";

// Node ≥ 20.12 loads .env natively; no dotenv dependency needed.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file (e.g. CI / production): rely on the real environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
