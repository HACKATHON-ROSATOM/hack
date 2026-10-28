ALTER TABLE "TelemetryObservation"
  ADD COLUMN "alarmBaseline" BOOLEAN,
  ADD COLUMN "alarmFresh" BOOLEAN,
  ADD COLUMN "alarmProcessed" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX "TelemetryObservation_pending_alarm_idx"
  ON "TelemetryObservation" ("id") WHERE "alarmProcessed" = FALSE;
