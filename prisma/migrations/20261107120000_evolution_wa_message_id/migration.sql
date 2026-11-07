-- WhatsApp delivery now runs through Evolution API (Baileys).
-- Columns are renamed (not dropped and re-added) so existing rows keep their data.

-- Lead: providerMessageId -> waMessageId; the 24 h service-window column no longer applies.
ALTER TABLE "Lead" RENAME COLUMN "providerMessageId" TO "waMessageId";
ALTER TABLE "Lead" DROP COLUMN "lastInboundAt";
CREATE INDEX "Lead_waMessageId_idx" ON "Lead"("waMessageId");

-- MessageLog: providerMessageId -> waMessageId (still the idempotency key).
ALTER TABLE "MessageLog" RENAME COLUMN "providerMessageId" TO "waMessageId";
ALTER INDEX "MessageLog_providerMessageId_key" RENAME TO "MessageLog_waMessageId_key";

-- MessageKind: the outbound message is plain text now; the 'template' kind is removed.
UPDATE "MessageLog" SET "kind" = 'text' WHERE "kind" = 'template';
ALTER TYPE "MessageKind" RENAME TO "MessageKind_old";
CREATE TYPE "MessageKind" AS ENUM ('text', 'status');
ALTER TABLE "MessageLog" ALTER COLUMN "kind" TYPE "MessageKind" USING ("kind"::text::"MessageKind");
DROP TYPE "MessageKind_old";
