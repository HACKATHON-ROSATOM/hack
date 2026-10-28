ALTER TABLE "Equipment" ALTER COLUMN "externalId" DROP NOT NULL;
ALTER TABLE "Equipment" ADD COLUMN "externalIdType" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "externalIdKey" TEXT;
UPDATE "Equipment" SET "externalIdType" = 'string', "externalIdKey" = "externalId";
ALTER TABLE "Equipment" ALTER COLUMN "externalIdKey" SET NOT NULL;
DROP INDEX "Equipment_externalId_key";
CREATE UNIQUE INDEX "Equipment_externalIdKey_key" ON "Equipment"("externalIdKey");
