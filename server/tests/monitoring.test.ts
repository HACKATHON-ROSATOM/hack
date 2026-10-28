import { describe, expect, it } from "vitest";
import { RequestsRepository } from "../src/modules/requests/repository.ts";
import type { StatusEvent, TelemetryStatus } from "../src/modules/monitoring/service.ts";

function event(value: number, second: number, baseline = false): StatusEvent {
  const statuses: Record<number, TelemetryStatus> = {
    1: "STOPPED",
    3: "READY",
    4: "RUNNING",
    8: "ALARM",
  };
  return {
    turbineId: "turbine-1",
    turbineNumber: 1,
    ca: 1,
    ioa: 8192,
    status: statuses[value] ?? "UNKNOWN",
    value,
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
    fresh: true,
    baseline,
  };
}

describe("аварийные эпизоды", () => {
  it("создаёт заявку только при подтверждённом переходе и не дублирует повторную аварию", async () => {
    const repo = new RequestsRepository();
    expect(await repo.processTelemetry(event(4, 0, true))).toBeNull();
    const first = await repo.processTelemetry(event(8, 1));
    expect(first).toMatchObject({
      source: "AUTO",
      status: "NEW",
      telemetryTurbineId: "turbine-1",
      equipmentId: null,
      authorId: null,
      initialDeadline: null,
      currentDeadline: null,
      isOverdue: false,
    });
    expect(first?.auditLogs).toMatchObject([{ action: "CREATED", authorId: null }]);
    expect(await repo.processTelemetry(event(8, 2))).toBeNull();
    expect(await repo.processTelemetry(event(4, 3))).toBeNull();
    const second = await repo.processTelemetry(event(8, 4));
    expect(second?.id).not.toBe(first?.id);
    expect((await repo.findMany()).filter((ticket) => ticket.source === "AUTO")).toHaveLength(2);
  });

  it("не создаёт заявку на первом значении после связи или после неизвестного статуса", async () => {
    const repo = new RequestsRepository();
    expect(await repo.processTelemetry(event(8, 0, true))).toBeNull();
    expect(await repo.processTelemetry(event(8, 1, true))).toBeNull();
    expect(await repo.processTelemetry(event(4, 2))).toBeNull();
    expect(await repo.processTelemetry(event(7.9, 3))).toBeNull();
    expect(await repo.processTelemetry(event(8, 4))).toBeNull();
    expect(await repo.processTelemetry(event(4, 5))).toBeNull();
    expect((await repo.processTelemetry(event(8, 6)))?.source).toBe("AUTO");
  });
});
