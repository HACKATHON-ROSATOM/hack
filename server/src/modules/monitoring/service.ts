import type { Database } from "../../database.ts";

const FIRST_IOA = 8192;
const TURBINE_COUNT = 8;
const FRESH_MS = 5_000;

const signalDefinitions = [
  { key: "status", label: "Статус", unit: "" },
  { key: "activePower", label: "Активная мощность", unit: "кВт" },
  { key: "reactivePower", label: "Реактивная мощность", unit: "квар" },
  { key: "windSpeed", label: "Скорость ветра", unit: "м/с" },
  { key: "windDirection", label: "Направление ветра", unit: "° от севера" },
  { key: "temperature", label: "Температура воздуха гондолы", unit: "°C" },
] as const;

export type TelemetryStatus = "STOPPED" | "READY" | "RUNNING" | "ALARM" | "UNKNOWN";
export type TelemetrySnapshot = {
  readonly turbineId: string;
  readonly turbineNumber: number;
  readonly ca: number;
  readonly ioa: number;
  readonly status: TelemetryStatus;
  readonly value: number;
  readonly receivedAt: string;
  readonly fresh: boolean;
};
export type ObservationInput = { ca: number; ioa: number; value: number; receivedAt: Date };
type Observation = ObservationInput & { id: number };
export type StatusEvent = TelemetrySnapshot & { readonly baseline: boolean };
type StatusListener = (event: StatusEvent, observationId: number) => void | Promise<void>;
type PendingObservation = Observation & { alarmBaseline: boolean; alarmFresh: boolean };

export function isMonitoringIoa(ioa: number): boolean {
  return (
    Number.isInteger(ioa) &&
    ioa >= FIRST_IOA &&
    ioa < FIRST_IOA + TURBINE_COUNT * signalDefinitions.length
  );
}

export function decodeStatus(value: number): TelemetryStatus {
  switch (value) {
    case 1:
      return "STOPPED";
    case 3:
      return "READY";
    case 4:
      return "RUNNING";
    case 8:
      return "ALARM";
    default:
      return "UNKNOWN";
  }
}

export class MonitoringService {
  private connected = false;
  private generation = 0;
  private currentIds = new Map<number, number>();
  private statusListeners = new Set<StatusListener>();
  private baselineIoas = new Set<number>();
  private receiveQueue: Promise<void> = Promise.resolve();
  private processing: Promise<void> | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private processingEnabled = false;

  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  setConnected(connected: boolean): void {
    if (this.connected !== connected) {
      this.connected = connected;
      this.generation += 1;
      this.currentIds.clear();
      this.baselineIoas = new Set<number>();
    }
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  startProcessing(): void {
    if (this.processingEnabled) return;
    this.processingEnabled = true;
    this.scheduleProcessing(0);
  }

  async stopProcessing(): Promise<void> {
    this.processingEnabled = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.processing;
    await this.receiveQueue;
  }

  private scheduleProcessing(delay: number): void {
    if (!this.processingEnabled || this.retryTimer || this.processing) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.processing = this.drainPending()
        .catch((error: unknown) => {
          console.error("Alarm observation processing failed:", error);
        })
        .finally(() => {
          this.processing = undefined;
          this.scheduleProcessing(1_000);
        });
    }, delay);
    this.retryTimer.unref();
  }

  private async drainPending(): Promise<void> {
    while (this.processingEnabled && this.statusListeners.size > 0) {
      const [stored] = await this.db.$queryRaw<PendingObservation[]>`
        SELECT "id", "ca", "ioa", "value", "receivedAt", "alarmBaseline", "alarmFresh"
        FROM "TelemetryObservation" WHERE "alarmProcessed" = false ORDER BY "id" LIMIT 1
      `;
      if (!stored) return;
      const event: StatusEvent = Object.freeze({
        ...this.toSnapshot(stored),
        fresh: stored.alarmFresh,
        baseline: stored.alarmBaseline,
      });
      for (const listener of this.statusListeners) await listener(event, stored.id);
    }
  }

  async receive(input: ObservationInput): Promise<void> {
    if (
      input.ca !== 1 ||
      !isMonitoringIoa(input.ioa) ||
      !Number.isFinite(input.value) ||
      !(input.receivedAt instanceof Date) ||
      !Number.isFinite(input.receivedAt.getTime())
    ) {
      throw new RangeError("Invalid telemetry observation.");
    }
    const observation = { ...input, receivedAt: new Date(input.receivedAt) };
    const generation = this.generation;
    const receivedConnected = this.connected;
    const baselines = this.baselineIoas;
    const isStatus = (input.ioa - FIRST_IOA) % signalDefinitions.length === 0;
    const task = this.receiveQueue.then(async () => {
      const baseline = receivedConnected && isStatus ? !baselines.has(input.ioa) : null;
      const stored = await this.db
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(811048192)`;
          const age = Date.now() - observation.receivedAt.getTime();
          const fresh =
            receivedConnected &&
            this.connected &&
            this.generation === generation &&
            age >= 0 &&
            age <= FRESH_MS;
          const [row] = await tx.$queryRaw<Observation[]>`
          INSERT INTO "TelemetryObservation"
            ("ca", "ioa", "value", "receivedAt", "alarmBaseline", "alarmFresh", "alarmProcessed")
          VALUES (${observation.ca}, ${observation.ioa}, ${observation.value}, ${observation.receivedAt},
            ${baseline}, ${baseline === null ? null : fresh}, ${baseline === null})
          RETURNING "id", "ca", "ioa", "value", "receivedAt"
        `;
          if (!row) throw new Error("Telemetry observation was not stored.");
          return row;
        })
        .catch((error: unknown) => {
          if (baseline !== null) baselines.delete(input.ioa);
          throw error;
        });
      if (baseline !== null) {
        baselines.add(stored.ioa);
        this.scheduleProcessing(0);
      }
      if (receivedConnected && this.connected && this.generation === generation) {
        this.currentIds.set(stored.ioa, stored.id);
      }
    });
    this.receiveQueue = task.catch(() => {});
    return task;
  }

  private isFresh(observation: Observation, now: number): boolean {
    const age = now - observation.receivedAt.getTime();
    return (
      this.connected &&
      this.currentIds.get(observation.ioa) === observation.id &&
      age >= 0 &&
      age <= FRESH_MS
    );
  }

  private toSnapshot(observation: Observation): TelemetrySnapshot {
    const turbineNumber = Math.floor((observation.ioa - FIRST_IOA) / signalDefinitions.length) + 1;
    return Object.freeze({
      turbineId: `turbine-${turbineNumber}`,
      turbineNumber,
      ca: observation.ca,
      ioa: observation.ioa,
      status: decodeStatus(observation.value),
      value: observation.value,
      receivedAt: observation.receivedAt.toISOString(),
      fresh: this.isFresh(observation, Date.now()),
    });
  }

  async getCurrent() {
    const observations = await this.db.$queryRaw<Observation[]>`
      SELECT DISTINCT ON ("ioa") "id", "ca", "ioa", "value", "receivedAt"
      FROM "TelemetryObservation"
      ORDER BY "ioa", "receivedAt" DESC, "id" DESC
    `;
    const latest = new Map(observations.map((observation) => [observation.ioa, observation]));
    const now = Date.now();
    return {
      connected: this.connected,
      turbines: Array.from({ length: TURBINE_COUNT }, (_, index) => ({
        id: `turbine-${index + 1}`,
        number: index + 1,
        signals: signalDefinitions.map((definition, offset) => {
          const ioa = FIRST_IOA + index * signalDefinitions.length + offset;
          const observation = latest.get(ioa);
          const fresh = observation ? this.isFresh(observation, now) : false;
          return {
            ...definition,
            ioa,
            value: observation?.value ?? null,
            receivedAt: observation?.receivedAt.toISOString() ?? null,
            fresh,
            freshForMs:
              fresh && observation
                ? Math.max(0, FRESH_MS - (now - observation.receivedAt.getTime()))
                : 0,
          };
        }),
      })),
    };
  }

  async getSnapshot(turbineNumber: number): Promise<TelemetrySnapshot | null> {
    if (!Number.isInteger(turbineNumber) || turbineNumber < 1 || turbineNumber > TURBINE_COUNT) {
      throw new RangeError("Invalid turbine number.");
    }
    const ioa = FIRST_IOA + (turbineNumber - 1) * signalDefinitions.length;
    const observation = await this.db.telemetryObservation.findFirst({
      where: { ioa },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    });
    return observation ? this.toSnapshot(observation) : null;
  }

  async getHistory(ioa: number) {
    if (!isMonitoringIoa(ioa)) throw new RangeError("Invalid telemetry IOA.");
    const observations = await this.db.telemetryObservation.findMany({
      where: { ioa },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: 1000,
      select: { value: true, receivedAt: true },
    });
    return {
      items: observations.reverse().map((item) => ({
        value: item.value,
        receivedAt: item.receivedAt.toISOString(),
      })),
    };
  }
}
