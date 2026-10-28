import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.ts";
import { MonitoringService, type StatusEvent } from "../src/modules/monitoring/service.ts";
import { RequestsRepository } from "../src/modules/requests/repository.ts";

type Row = {
  id: number;
  ca: number;
  ioa: number;
  value: number;
  receivedAt: Date;
  alarmBaseline: boolean | null;
  alarmFresh: boolean | null;
  alarmProcessed: boolean;
};

function database() {
  const rows: Row[] = [];
  let unavailable = false;
  const db = {
    $queryRaw: async () => {
      if (unavailable) throw new Error("database unavailable");
      return rows.filter((row) => !row.alarmProcessed).slice(0, 1);
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      if (unavailable) throw new Error("database unavailable");
      return operation({
        $executeRaw: async () => 0,
        $queryRaw: async (_query: TemplateStringsArray, ...values: unknown[]) => {
          const [ca, ioa, value, receivedAt, alarmBaseline, alarmFresh, alarmProcessed] = values;
          const row = {
            id: rows.length + 1,
            ca,
            ioa,
            value,
            receivedAt,
            alarmBaseline,
            alarmFresh,
            alarmProcessed,
          } as Row;
          rows.push(row);
          return [row];
        },
      });
    },
    telemetryObservation: {
      findFirst: async () => rows.at(-1) ?? null,
    },
  } as unknown as Database;
  return {
    db,
    rows,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
  };
}

async function receive(service: MonitoringService, value: number) {
  await service.receive({ ca: 1, ioa: 8192, value, receivedAt: new Date() });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("durable alarm observations", () => {
  it("retries a failed transition in arrival order after restart without repeating an alarm", async () => {
    vi.useFakeTimers();
    const { db, rows } = database();
    const repo = new RequestsRepository();
    const first = new MonitoringService(db);
    const seen: number[] = [];
    first.subscribeStatus(async (event, id) => {
      seen.push(event.value);
      if (event.value === 8) throw new Error("transition unavailable");
      await repo.processTelemetry(event);
      rows[id - 1]!.alarmProcessed = true;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    first.startProcessing();
    first.setConnected(true);
    await receive(first, 4);
    await receive(first, 8);
    await receive(first, 8);
    await receive(first, 4);
    await receive(first, 8);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([4, 8]);
    expect(rows.map((row) => row.alarmProcessed)).toEqual([true, false, false, false, false]);
    await first.stopProcessing();

    const second = new MonitoringService(db);
    second.subscribeStatus(async (event, id) => {
      seen.push(event.value);
      await repo.processTelemetry(event);
      rows[id - 1]!.alarmProcessed = true;
    });
    second.startProcessing();
    await vi.advanceTimersByTimeAsync(0);
    await second.stopProcessing();
    expect(seen).toEqual([4, 8, 8, 8, 4, 8]);
    expect(rows.every((row) => row.alarmProcessed)).toBe(true);
    expect((await repo.findMany()).filter((ticket) => ticket.source === "AUTO")).toHaveLength(2);
  });

  it("preserves reconnect baselines, unknown statuses and five-second freshness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { db, rows } = database();
    const service = new MonitoringService(db);
    const events: StatusEvent[] = [];
    const repo = new RequestsRepository();
    service.subscribeStatus(async (event, id) => {
      events.push(event);
      await repo.processTelemetry(event);
      rows[id - 1]!.alarmProcessed = true;
    });
    service.startProcessing();
    service.setConnected(true);
    await receive(service, 4);
    expect((await service.getSnapshot(1))?.fresh).toBe(true);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await service.getSnapshot(1))?.fresh).toBe(false);
    await receive(service, 7.9);
    await receive(service, 8);
    service.setConnected(false);
    service.setConnected(true);
    await receive(service, 8);
    await receive(service, 4);
    await receive(service, 8);
    await vi.advanceTimersByTimeAsync(1000);
    await service.stopProcessing();
    expect(events.map((event) => event.baseline)).toEqual([true, false, false, true, false, false]);
    expect((await repo.findMany()).filter((ticket) => ticket.source === "AUTO")).toHaveLength(1);
  });
});
