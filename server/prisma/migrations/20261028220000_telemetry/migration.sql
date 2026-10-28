CREATE TABLE "TelemetryObservation" (
  "id" SERIAL NOT NULL,
  "ca" INTEGER NOT NULL,
  "ioa" INTEGER NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "receivedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "TelemetryObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelemetryObservation_ioa_receivedAt_id_idx" ON "TelemetryObservation"("ioa", "receivedAt", "id");
