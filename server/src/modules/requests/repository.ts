import { randomUUID } from "node:crypto";
import type { Database } from "../../database.ts";
import { ApiError } from "../../http/problem.ts";
import type { StatusEvent, TelemetrySnapshot } from "../monitoring/service.ts";
import type {
  AuditAction,
  Priority,
  Ticket,
  TicketAuditLog,
  TicketSource,
  TicketStatus,
  TicketType,
  TicketWithDetails,
} from "./types.ts";

export interface CreateTicketData {
  type: TicketType;
  equipmentId: string;
  description: string;
  priority: Priority;
  initialDeadline: string;
  assigneeId?: string | undefined;
  authorId: string;
}

export interface TicketFilters {
  status?: TicketStatus | undefined;
  type?: TicketType | undefined;
  assigneeId?: string | undefined;
  isOverdue?: boolean | undefined;
}

export interface AuditEntryData {
  action: AuditAction;
  fieldName?: string | null | undefined;
  oldValue?: string | null | undefined;
  newValue?: string | null | undefined;
  comment?: string | null | undefined;
  authorId?: string | null | undefined;
}

export interface IRequestsRepository {
  processTelemetry(
    snapshot: StatusEvent,
    observationId?: number,
  ): Promise<TicketWithDetails | null>;
  attachSnapshot(
    ticketId: string,
    snapshot: TelemetrySnapshot,
    actorId: string,
  ): Promise<TicketWithDetails>;
  create(data: CreateTicketData): Promise<TicketWithDetails>;
  findById(id: string): Promise<TicketWithDetails | null>;
  findMany(filters?: TicketFilters): Promise<TicketWithDetails[]>;
  update(
    id: string,
    updates: Partial<Ticket>,
    auditEntries: AuditEntryData | AuditEntryData[],
  ): Promise<TicketWithDetails | null>;
  mutate(
    id: string,
    operation: (existing: TicketWithDetails) => Promise<{
      updates: Partial<Ticket>;
      auditEntries: AuditEntryData | AuditEntryData[];
    }>,
  ): Promise<TicketWithDetails>;
  getOverdue(): Promise<TicketWithDetails[]>;
  getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>>;
}

export class RequestsRepository implements IRequestsRepository {
  private db?: Database | undefined;
  private inMemoryTickets = new Map<string, Ticket>();
  private inMemoryAudit = new Map<string, TicketAuditLog[]>();
  private lockQueues = new Map<string, Promise<void>>();
  private telemetryState = new Map<
    string,
    { value: number | null; receivedAt: number; baselineReady: boolean }
  >();
  private nextSequence = 1;

  constructor(db?: Database) {
    this.db = db;
  }

  async processTelemetry(
    snapshot: StatusEvent,
    observationId?: number,
  ): Promise<TicketWithDetails | null> {
    const statuses: Record<number, TelemetrySnapshot["status"]> = {
      1: "STOPPED",
      3: "READY",
      4: "RUNNING",
      8: "ALARM",
    };
    const known =
      statuses[snapshot.value] !== undefined && statuses[snapshot.value] === snapshot.status;
    if (!known && snapshot.status !== "UNKNOWN") return null;
    const receivedAt = new Date(snapshot.receivedAt);
    if (!Number.isFinite(receivedAt.getTime()))
      throw new RangeError("Invalid telemetry timestamp.");
    const { baseline, ...telemetry } = snapshot;
    const event = Object.freeze(telemetry);
    const description = `Аварийный статус турбины ${event.turbineNumber}: значение ${event.value}, CA ${event.ca}, IOA ${event.ioa}, время ${event.receivedAt}.`;

    if (this.db) {
      return this.db.$transaction(async (tx) => {
        if (observationId !== undefined) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(811048192)`;
          const [pending] = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id" FROM "TelemetryObservation"
            WHERE "alarmProcessed" = false ORDER BY "id" LIMIT 1 FOR UPDATE
          `;
          if (!pending || pending.id > observationId) return null;
          if (pending.id !== observationId)
            throw new Error("Earlier alarm observation is pending.");
        }
        const process = async (): Promise<TicketWithDetails | null> => {
          const value = known ? event.value : null;
          const inserted = await tx.$queryRaw<Array<{ turbineId: string }>>`
            INSERT INTO "AlarmTelemetryState" ("turbineId", "value", "receivedAt", "baselineReady")
            VALUES (${event.turbineId}, ${value}, ${receivedAt}, ${known})
            ON CONFLICT ("turbineId") DO NOTHING RETURNING "turbineId"
          `;
          if (inserted.length) return null;
          const [state] = await tx.$queryRaw<
            Array<{ value: number | null; receivedAt: Date; baselineReady: boolean }>
          >`
            SELECT "value", "receivedAt", "baselineReady" FROM "AlarmTelemetryState"
            WHERE "turbineId" = ${event.turbineId} FOR UPDATE
          `;
          if (
            !state ||
            (observationId === undefined && receivedAt.getTime() < state.receivedAt.getTime())
          )
            return null;
          if (!known) {
            await tx.$executeRaw`
              UPDATE "AlarmTelemetryState" SET "receivedAt" = ${receivedAt}, "baselineReady" = false
              WHERE "turbineId" = ${event.turbineId}
            `;
            return null;
          }
          await tx.$executeRaw`
            UPDATE "AlarmTelemetryState" SET "value" = ${event.value}, "receivedAt" = ${receivedAt}, "baselineReady" = true
            WHERE "turbineId" = ${event.turbineId}
          `;
          if (baseline || !state.baselineReady || event.value !== 8 || state.value === 8)
            return null;
          const ticket = await tx.ticket.create({
            data: {
              type: "INSPECTION",
              source: "AUTO",
              telemetryTurbineId: event.turbineId,
              snapshot: { ...event },
              description,
              auditLogs: {
                create: {
                  action: "CREATED",
                  comment: "Заявка создана автоматически по аварийному сигналу.",
                },
              },
            },
            include: { auditLogs: { orderBy: { createdAt: "asc" } } },
          });
          return this.mapPrismaTicket(ticket);
        };
        const result = await process();
        if (observationId !== undefined) {
          await tx.$executeRaw`
            UPDATE "TelemetryObservation" SET "alarmProcessed" = true WHERE "id" = ${observationId}
          `;
        }
        return result;
      });
    }

    const release = await this.acquireLock(`telemetry:${event.turbineId}`);
    try {
      const state = this.telemetryState.get(event.turbineId);
      if (state && receivedAt.getTime() < state.receivedAt) return null;
      this.telemetryState.set(event.turbineId, {
        value: known ? event.value : (state?.value ?? null),
        receivedAt: receivedAt.getTime(),
        baselineReady: known,
      });
      if (
        !known ||
        baseline ||
        !state ||
        !state.baselineReady ||
        event.value !== 8 ||
        state.value === 8
      )
        return null;
      const ticket: Ticket = {
        id: randomUUID(),
        ticketNumber: this.nextSequence++,
        type: "INSPECTION",
        source: "AUTO",
        status: "NEW",
        priority: "MEDIUM",
        equipmentId: null,
        authorId: null,
        assigneeId: null,
        description,
        telemetryTurbineId: event.turbineId,
        snapshot: event,
        initialDeadline: null,
        currentDeadline: null,
        completionComment: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        version: 1,
      };
      this.inMemoryTickets.set(ticket.id, ticket);
      const log: TicketAuditLog = {
        id: randomUUID(),
        ticketId: ticket.id,
        authorId: null,
        action: "CREATED",
        fieldName: null,
        oldValue: null,
        newValue: null,
        comment: "Заявка создана автоматически по аварийному сигналу.",
        createdAt: ticket.createdAt,
      };
      this.inMemoryAudit.set(ticket.id, [log]);
      return { ...ticket, isOverdue: false, auditLogs: [log] };
    } finally {
      release();
    }
  }

  async attachSnapshot(
    ticketId: string,
    snapshot: TelemetrySnapshot,
    actorId: string,
  ): Promise<TicketWithDetails> {
    const event = Object.freeze({ ...snapshot });
    if (this.db) {
      return this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId}::uuid FOR UPDATE`;
        const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) throw new ApiError(404, `Заявка с идентификатором '${ticketId}' не найдена.`);
        if (ticket.source !== "MANUAL")
          throw new ApiError(400, "Снимок можно прикрепить только к ручной заявке.");
        if (ticket.snapshot !== null) throw new ApiError(409, "Снимок уже прикреплён.");
        const updated = await tx.ticket.update({
          where: { id: ticketId },
          data: {
            snapshot: { ...event },
            telemetryTurbineId: event.turbineId,
            version: { increment: 1 },
            auditLogs: {
              create: {
                authorId: actorId,
                action: "COMMENT_ADDED",
                fieldName: "snapshot",
                comment: "Прикреплён снимок телеметрии",
              },
            },
          },
          include: { auditLogs: { orderBy: { createdAt: "asc" } } },
        });
        return this.mapPrismaTicket(updated);
      });
    }
    const release = await this.acquireLock(ticketId);
    try {
      const ticket = this.inMemoryTickets.get(ticketId);
      if (!ticket) throw new ApiError(404, `Заявка с идентификатором '${ticketId}' не найдена.`);
      if (ticket.source !== "MANUAL")
        throw new ApiError(400, "Снимок можно прикрепить только к ручной заявке.");
      if (ticket.snapshot !== null) throw new ApiError(409, "Снимок уже прикреплён.");
      const updated = {
        ...ticket,
        snapshot: event,
        telemetryTurbineId: event.turbineId,
        version: ticket.version + 1,
      };
      const logs = [
        ...(this.inMemoryAudit.get(ticketId) ?? []),
        {
          id: randomUUID(),
          ticketId,
          authorId: actorId,
          action: "COMMENT_ADDED" as const,
          fieldName: "snapshot",
          oldValue: null,
          newValue: null,
          comment: "Прикреплён снимок телеметрии",
          createdAt: new Date().toISOString(),
        },
      ];
      this.inMemoryTickets.set(ticketId, updated);
      this.inMemoryAudit.set(ticketId, logs);
      return {
        ...updated,
        isOverdue: this.isOverdue(updated.status, updated.currentDeadline),
        auditLogs: logs,
      };
    } finally {
      release();
    }
  }

  private async acquireLock(id: string): Promise<() => void> {
    const currentLock = this.lockQueues.get(id) ?? Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.lockQueues.set(id, promise);
    await currentLock;
    return () => {
      if (this.lockQueues.get(id) === promise) {
        this.lockQueues.delete(id);
      }
      resolve();
    };
  }

  private isOverdue(status: TicketStatus, deadline: string | Date | null | undefined): boolean {
    if (status === "COMPLETED" || !deadline) return false;
    const ms = typeof deadline === "string" ? new Date(deadline).getTime() : deadline.getTime();
    return ms < Date.now();
  }

  private mapPrismaTicket(ticket: {
    id: string;
    ticketNumber: number;
    version: number;
    type: TicketType;
    source: string;
    telemetryTurbineId: string | null;
    snapshot: unknown;
    status: TicketStatus;
    priority: Priority;
    equipmentId: string | null;
    authorId: string | null;
    assigneeId: string | null;
    description: string;
    initialDeadline: Date | null;
    currentDeadline: Date | null;
    completionComment: string | null;
    createdAt: Date;
    completedAt: Date | null;
    auditLogs?: Array<{
      id: string;
      ticketId: string;
      authorId: string | null;
      action: AuditAction;
      fieldName: string | null;
      oldValue: string | null;
      newValue: string | null;
      comment: string | null;
      createdAt: Date;
    }>;
  }): TicketWithDetails {
    const isOverdue = this.isOverdue(ticket.status, ticket.currentDeadline);
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      type: ticket.type,
      source: ticket.source as TicketSource,
      status: ticket.status,
      priority: ticket.priority,
      equipmentId: ticket.equipmentId,
      authorId: ticket.authorId,
      assigneeId: ticket.assigneeId,
      description: ticket.description,
      telemetryTurbineId: ticket.telemetryTurbineId,
      snapshot: ticket.snapshot as TelemetrySnapshot | null,
      initialDeadline: ticket.initialDeadline?.toISOString() ?? null,
      currentDeadline: ticket.currentDeadline?.toISOString() ?? null,
      completionComment: ticket.completionComment,
      createdAt: ticket.createdAt.toISOString(),
      completedAt: ticket.completedAt ? ticket.completedAt.toISOString() : null,
      version: ticket.version,
      isOverdue,
      auditLogs: (ticket.auditLogs ?? []).map((log) => ({
        id: log.id,
        ticketId: log.ticketId,
        authorId: log.authorId,
        action: log.fieldName === "type" ? "TYPE_CHANGED" : log.action,
        fieldName: log.fieldName,
        oldValue: log.oldValue,
        newValue: log.newValue,
        comment: log.comment,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  async create(data: CreateTicketData): Promise<TicketWithDetails> {
    if (this.db) {
      const initialDeadline = new Date(data.initialDeadline);
      const auditCreate: Array<{
        authorId: string;
        action: AuditAction;
        fieldName?: string | null;
        oldValue?: string | null;
        newValue?: string | null;
        comment?: string | null;
      }> = [
        {
          authorId: data.authorId,
          action: "CREATED",
          comment: "Заявка создана",
        },
      ];

      if (data.assigneeId) {
        auditCreate.push({
          authorId: data.authorId,
          action: "ASSIGNED",
          fieldName: "assigneeId",
          oldValue: null,
          newValue: data.assigneeId,
          comment: "Первоначальное назначение исполнителя",
        });
      }

      const created = await this.db.ticket.create({
        data: {
          type: data.type,
          priority: data.priority,
          description: data.description,
          equipmentId: data.equipmentId,
          authorId: data.authorId,
          assigneeId: data.assigneeId ?? null,
          initialDeadline,
          currentDeadline: initialDeadline,
          auditLogs: {
            create: auditCreate,
          },
        },
        include: {
          auditLogs: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return this.mapPrismaTicket(created);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const ticketNumber = this.nextSequence++;

    const ticket: Ticket = {
      id,
      ticketNumber,
      type: data.type,
      source: "MANUAL",
      status: "NEW",
      priority: data.priority,
      equipmentId: data.equipmentId,
      authorId: data.authorId,
      assigneeId: data.assigneeId ?? null,
      description: data.description,
      telemetryTurbineId: null,
      snapshot: null,
      initialDeadline: data.initialDeadline,
      currentDeadline: data.initialDeadline,
      completionComment: null,
      createdAt: now,
      completedAt: null,
      version: 1,
    };

    const initialAudit: TicketAuditLog = {
      id: randomUUID(),
      ticketId: id,
      authorId: data.authorId,
      action: "CREATED",
      fieldName: null,
      oldValue: null,
      newValue: null,
      comment: "Заявка создана",
      createdAt: now,
    };

    const auditLogs = [initialAudit];
    if (data.assigneeId) {
      auditLogs.push({
        id: randomUUID(),
        ticketId: id,
        authorId: data.authorId,
        action: "ASSIGNED",
        fieldName: "assigneeId",
        oldValue: null,
        newValue: data.assigneeId,
        comment: "Первоначальное назначение исполнителя",
        createdAt: now,
      });
    }

    this.inMemoryTickets.set(id, ticket);
    this.inMemoryAudit.set(id, auditLogs);

    return {
      ...ticket,
      isOverdue: this.isOverdue(ticket.status, ticket.currentDeadline),
      auditLogs,
    };
  }

  async findById(id: string): Promise<TicketWithDetails | null> {
    if (this.db) {
      const ticket = await this.db.ticket.findUnique({
        where: { id },
        include: {
          auditLogs: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!ticket) return null;
      return this.mapPrismaTicket(ticket);
    }

    const ticket = this.inMemoryTickets.get(id);
    if (!ticket) return null;
    const auditLogs = this.inMemoryAudit.get(id) ?? [];
    return {
      ...ticket,
      isOverdue: this.isOverdue(ticket.status, ticket.currentDeadline),
      auditLogs,
    };
  }

  async findMany(filters?: TicketFilters): Promise<TicketWithDetails[]> {
    if (this.db) {
      const where: {
        status?: TicketStatus;
        type?: TicketType;
        assigneeId?: string;
        AND?: Array<Record<string, unknown>>;
      } = {};

      if (filters?.status !== undefined) where.status = filters.status;
      if (filters?.type !== undefined) where.type = filters.type;
      if (filters?.assigneeId !== undefined) where.assigneeId = filters.assigneeId;
      if (filters?.isOverdue === true) {
        where.AND = [
          { status: { not: "COMPLETED" as const } },
          { currentDeadline: { lt: new Date() } },
        ];
      } else if (filters?.isOverdue === false) {
        where.AND = [
          {
            OR: [
              { status: "COMPLETED" as const },
              { currentDeadline: null },
              { currentDeadline: { gte: new Date() } },
            ],
          },
        ];
      }

      const tickets = await this.db.ticket.findMany({
        where,
        orderBy: { ticketNumber: "asc" },
        include: {
          auditLogs: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return tickets.map((t) => this.mapPrismaTicket(t));
    }

    let tickets = Array.from(this.inMemoryTickets.values());
    if (filters?.status !== undefined) {
      tickets = tickets.filter((t) => t.status === filters.status);
    }
    if (filters?.type !== undefined) {
      tickets = tickets.filter((t) => t.type === filters.type);
    }
    if (filters?.assigneeId !== undefined) {
      tickets = tickets.filter((t) => t.assigneeId === filters.assigneeId);
    }
    if (filters?.isOverdue !== undefined) {
      tickets = tickets.filter(
        (t) => this.isOverdue(t.status, t.currentDeadline) === filters.isOverdue,
      );
    }

    return tickets.map((t) => ({
      ...t,
      isOverdue: this.isOverdue(t.status, t.currentDeadline),
      auditLogs: this.inMemoryAudit.get(t.id) ?? [],
    }));
  }

  async update(
    id: string,
    updates: Partial<Ticket>,
    auditEntries: AuditEntryData | AuditEntryData[],
  ): Promise<TicketWithDetails | null> {
    const entries = Array.isArray(auditEntries) ? auditEntries : [auditEntries];

    if (this.db) {
      return this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const existing = await tx.ticket.findUnique({ where: { id } });
        if (!existing) return null;

        const updateData: {
          version: { increment: number };
          status?: TicketStatus;
          type?: TicketType;
          priority?: Priority;
          assigneeId?: string | null;
          currentDeadline?: Date | null;
          completionComment?: string | null;
          completedAt?: Date | null;
          auditLogs: {
            create: Array<{
              authorId: string;
              action: AuditAction;
              fieldName?: string | null;
              oldValue?: string | null;
              newValue?: string | null;
              comment?: string | null;
            }>;
          };
        } = {
          version: { increment: 1 },
          auditLogs: {
            create: entries.map((entry) => ({
              authorId:
                entry.authorId ??
                existing.authorId ??
                (() => {
                  throw new Error("Audit author is required");
                })(),
              action: entry.action === "TYPE_CHANGED" ? "COMMENT_ADDED" : entry.action,
              fieldName: entry.fieldName ?? null,
              oldValue: entry.oldValue ? String(entry.oldValue) : null,
              newValue: entry.newValue ? String(entry.newValue) : null,
              comment: entry.comment ?? null,
            })),
          },
        };

        if (updates.status !== undefined) updateData.status = updates.status;
        if (updates.type !== undefined) updateData.type = updates.type;
        if (updates.priority !== undefined) updateData.priority = updates.priority;
        if (updates.assigneeId !== undefined) updateData.assigneeId = updates.assigneeId;
        if (updates.currentDeadline !== undefined) {
          updateData.currentDeadline = updates.currentDeadline
            ? new Date(updates.currentDeadline)
            : null;
        }
        if (updates.completionComment !== undefined) {
          updateData.completionComment = updates.completionComment;
        }
        if (updates.completedAt !== undefined) {
          updateData.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
        }

        const updated = await tx.ticket.update({
          where: { id },
          data: updateData,
          include: {
            auditLogs: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        return this.mapPrismaTicket(updated);
      });
    }

    const existing = this.inMemoryTickets.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updatedTicket: Ticket = {
      ...existing,
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.priority !== undefined && { priority: updates.priority }),
      ...(updates.assigneeId !== undefined && { assigneeId: updates.assigneeId }),
      ...(updates.currentDeadline !== undefined && { currentDeadline: updates.currentDeadline }),
      ...(updates.completionComment !== undefined && {
        completionComment: updates.completionComment,
      }),
      ...(updates.completedAt !== undefined && { completedAt: updates.completedAt }),
      version: existing.version + 1,
    };

    const existingLogs = this.inMemoryAudit.get(id) ?? [];
    for (const entry of entries) {
      existingLogs.push({
        id: randomUUID(),
        ticketId: id,
        authorId: entry.authorId ?? null,
        action: entry.action,
        fieldName: entry.fieldName ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        comment: entry.comment ?? null,
        createdAt: now,
      });
    }

    this.inMemoryTickets.set(id, updatedTicket);
    this.inMemoryAudit.set(id, existingLogs);

    return {
      ...updatedTicket,
      isOverdue: this.isOverdue(updatedTicket.status, updatedTicket.currentDeadline),
      auditLogs: existingLogs,
    };
  }

  async mutate(
    id: string,
    operation: (existing: TicketWithDetails) => Promise<{
      updates: Partial<Ticket>;
      auditEntries: AuditEntryData | AuditEntryData[];
    }>,
  ): Promise<TicketWithDetails> {
    if (this.db) {
      return this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const existingRecord = await tx.ticket.findUnique({
          where: { id },
          include: {
            auditLogs: {
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!existingRecord) {
          throw new ApiError(404, `Заявка с идентификатором '${id}' не найдена.`);
        }

        const existing = this.mapPrismaTicket(existingRecord);
        const { updates, auditEntries } = await operation(existing);
        const entries = Array.isArray(auditEntries) ? auditEntries : [auditEntries];

        const updateData: {
          version: { increment: number };
          status?: TicketStatus;
          type?: TicketType;
          priority?: Priority;
          assigneeId?: string | null;
          currentDeadline?: Date | null;
          completionComment?: string | null;
          completedAt?: Date | null;
          auditLogs: {
            create: Array<{
              authorId: string;
              action: AuditAction;
              fieldName?: string | null;
              oldValue?: string | null;
              newValue?: string | null;
              comment?: string | null;
            }>;
          };
        } = {
          version: { increment: 1 },
          auditLogs: {
            create: entries.map((entry) => ({
              authorId:
                entry.authorId ??
                existingRecord.authorId ??
                (() => {
                  throw new Error("Audit author is required");
                })(),
              action: entry.action === "TYPE_CHANGED" ? "COMMENT_ADDED" : entry.action,
              fieldName: entry.fieldName ?? null,
              oldValue: entry.oldValue ? String(entry.oldValue) : null,
              newValue: entry.newValue ? String(entry.newValue) : null,
              comment: entry.comment ?? null,
            })),
          },
        };

        if (updates.status !== undefined) updateData.status = updates.status;
        if (updates.type !== undefined) updateData.type = updates.type;
        if (updates.priority !== undefined) updateData.priority = updates.priority;
        if (updates.assigneeId !== undefined) updateData.assigneeId = updates.assigneeId;
        if (updates.currentDeadline !== undefined) {
          updateData.currentDeadline = updates.currentDeadline
            ? new Date(updates.currentDeadline)
            : null;
        }
        if (updates.completionComment !== undefined) {
          updateData.completionComment = updates.completionComment;
        }
        if (updates.completedAt !== undefined) {
          updateData.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
        }

        const updated = await tx.ticket.update({
          where: { id },
          data: updateData,
          include: {
            auditLogs: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        return this.mapPrismaTicket(updated);
      });
    }

    const release = await this.acquireLock(id);
    try {
      const existing = await this.findById(id);
      if (!existing) {
        throw new ApiError(404, `Заявка с идентификатором '${id}' не найдена.`);
      }
      const { updates, auditEntries } = await operation(existing);
      const updated = await this.update(id, updates, auditEntries);
      if (!updated) {
        throw new ApiError(404, `Заявка с идентификатором '${id}' не найдена.`);
      }
      return updated;
    } finally {
      release();
    }
  }

  async getOverdue(): Promise<TicketWithDetails[]> {
    return this.findMany({ isOverdue: true });
  }

  async getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>> {
    if (this.db) {
      const grouped = await this.db.ticket.groupBy({
        by: ["assigneeId"],
        where: {
          status: { not: "COMPLETED" },
          assigneeId: { not: null },
        },
        _count: {
          _all: true,
        },
      });

      return grouped.map((g) => ({
        engineerId: g.assigneeId!,
        activeTicketsCount: g._count._all,
      }));
    }

    const workloadMap = new Map<string, number>();
    for (const ticket of this.inMemoryTickets.values()) {
      if (ticket.status !== "COMPLETED" && ticket.assigneeId) {
        const count = workloadMap.get(ticket.assigneeId) ?? 0;
        workloadMap.set(ticket.assigneeId, count + 1);
      }
    }

    return Array.from(workloadMap.entries()).map(([engineerId, activeTicketsCount]) => ({
      engineerId,
      activeTicketsCount,
    }));
  }
}
