ALTER TABLE "Ticket"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "telemetryTurbineId" TEXT,
  ADD COLUMN "snapshot" JSONB,
  ALTER COLUMN "equipmentId" DROP NOT NULL,
  ALTER COLUMN "authorId" DROP NOT NULL,
  ALTER COLUMN "initialDeadline" DROP NOT NULL,
  ALTER COLUMN "currentDeadline" DROP NOT NULL,
  ADD CONSTRAINT "Ticket_source_check" CHECK ("source" IN ('MANUAL', 'AUTO'));

ALTER TABLE "TicketAuditLog" ALTER COLUMN "authorId" DROP NOT NULL;

CREATE TABLE "AlarmTelemetryState" (
  "turbineId" TEXT NOT NULL PRIMARY KEY,
  "value" INTEGER,
  "receivedAt" TIMESTAMPTZ NOT NULL,
  "baselineReady" BOOLEAN NOT NULL DEFAULT TRUE
);
