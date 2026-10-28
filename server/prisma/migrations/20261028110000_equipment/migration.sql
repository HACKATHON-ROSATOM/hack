CREATE TYPE "EquipmentType" AS ENUM ('GENERATOR', 'CONVERTER', 'LUBRICATION_SYSTEM', 'CONTROLLER', 'TRANSFORMER');
CREATE TABLE "Equipment" (
  "id" UUID NOT NULL, "externalId" TEXT NOT NULL, "name" TEXT NOT NULL, "type" "EquipmentType" NOT NULL,
  "hierarchyLevel0" TEXT, "hierarchyLevel1" TEXT, "hierarchyLevel2" TEXT, "hierarchyLevel3" TEXT,
  "hierarchyLevel4" TEXT, "hierarchyLevel5" TEXT, "hierarchyLevel6" TEXT, "typicalRepairObject" TEXT,
  "commissionedOn" DATE, "manufacturedOn" DATE, "workSchedule" TEXT, "usefulLifeMonths" INTEGER,
  "inventoryNumber" TEXT, "comment" TEXT, CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Equipment_externalId_key" ON "Equipment"("externalId");
CREATE TABLE "MaintenanceRecord" (
  "id" UUID NOT NULL, "importRowId" TEXT NOT NULL, "externalEquipmentId" TEXT NOT NULL, "equipmentId" UUID,
  "workType" TEXT, "statusAtImport" TEXT, "downtimeReason" TEXT, "completedOn" DATE, "operatingMetric" TEXT,
  "operatingUnit" TEXT, "plannedOperatingValue" DECIMAL(65,30), "plannedPeriod" TEXT, "periodDuration" DECIMAL(65,30),
  "workFrom" DATE, "workTo" DATE, "operatingValue" DECIMAL(65,30), "controlledIndicator" TEXT,
  "indicatorUnit" TEXT, "controlledOn" DATE, "indicatorValue" TEXT, "rawData" JSONB NOT NULL,
  "sourceSheet" TEXT NOT NULL, "sourceRow" INTEGER NOT NULL, CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceRecord_importRowId_key" ON "MaintenanceRecord"("importRowId");
CREATE INDEX "MaintenanceRecord_equipmentId_idx" ON "MaintenanceRecord"("equipmentId");
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
