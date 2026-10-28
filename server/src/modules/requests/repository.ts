import { randomUUID } from "node:crypto";
import type { Database } from "../../database.ts";
import type {
  AuditAction,
  Priority,
  Ticket,
  TicketAuditLog,
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
  create(data: CreateTicketData): Promise<TicketWithDetails>;
  findById(id: string): Promise<TicketWithDetails | null>;
  findMany(filters?: TicketFilters): Promise<TicketWithDetails[]>;
  update(
    id: string,
    updates: Partial<Ticket>,
    auditEntries: AuditEntryData | AuditEntryData[],
  ): Promise<TicketWithDetails | null>;
  getOverdue(): Promise<TicketWithDetails[]>;
  getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>>;
}

interface DbTicketRow {
  id: string;
  ticketNumber: number;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  equipmentId: string;
  authorId: string | null;
  assigneeId: string | null;
  description: string;
  initialDeadline: Date | string;
  currentDeadline: Date | string;
  completionComment: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
}

interface DbAuditRow {
  id: string;
  ticketId: string;
  authorId: string | null;
  action: AuditAction;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: Date | string;
}

interface DbWorkloadRow {
  assigneeId: string;
  count: number | string;
}

export class RequestsRepository implements IRequestsRepository {
  private db?: Database | undefined;
  private inMemoryTickets = new Map<string, Ticket>();
  private inMemoryAudit = new Map<string, TicketAuditLog[]>();
  private nextSequence = 1;

  constructor(db?: Database) {
    this.db = db;
  }

  private isOverdue(status: TicketStatus, deadline: string | Date | null | undefined): boolean {
    if (status === "COMPLETED" || !deadline) return false;
    const ms = typeof deadline === "string" ? new Date(deadline).getTime() : deadline.getTime();
    return ms < Date.now();
  }

  private mapToTicketWithDetails(
    record: DbTicketRow,
    auditLogs: DbAuditRow[] = [],
  ): TicketWithDetails {
    const isOverdue = this.isOverdue(record.status, record.currentDeadline);

    return {
      id: record.id,
      ticketNumber: record.ticketNumber,
      type: record.type,
      source: "MANUAL",
      status: record.status,
      priority: record.priority,
      equipmentId: record.equipmentId,
      authorId: record.authorId ?? null,
      assigneeId: record.assigneeId ?? null,
      description: record.description,
      initialDeadline: new Date(record.initialDeadline).toISOString(),
      currentDeadline: new Date(record.currentDeadline).toISOString(),
      completionComment: record.completionComment ?? null,
      createdAt: new Date(record.createdAt).toISOString(),
      completedAt: record.completedAt ? new Date(record.completedAt).toISOString() : null,
      version: 1,
      isOverdue,
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        ticketId: log.ticketId,
        authorId: log.authorId ?? null,
        action: log.fieldName === "type" ? "TYPE_CHANGED" : log.action,
        fieldName: log.fieldName ?? null,
        oldValue: log.oldValue ?? null,
        newValue: log.newValue ?? null,
        comment: log.comment ?? null,
        createdAt: new Date(log.createdAt).toISOString(),
      })),
    };
  }

  private async ensureSeedUsers(): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.$executeRawUnsafe(`
        INSERT INTO "User" ("id", "username", "password", "fullName", "role")
        VALUES 
          ('11111111-1111-4111-8111-111111111111', 'duty', 'duty123', 'Дежурный диспетчер', 'DUTY'::"Role"),
          ('22222222-2222-4222-8222-222222222222', 'engineer', 'engineer123', 'Сменный инженер', 'ENGINEER'::"Role"),
          ('33333333-3333-4333-8333-333333333333', 'director', 'director123', 'Главный директор', 'DIRECTOR'::"Role")
        ON CONFLICT ("id") DO NOTHING;
      `);
    } catch {}
  }

  async create(data: CreateTicketData): Promise<TicketWithDetails> {
    if (this.db) {
      await this.ensureSeedUsers();
      const id = randomUUID();
      const auditId = randomUUID();
      const initialDeadline = new Date(data.initialDeadline);

      return this.db.$transaction(async (tx) => {
        const inserted = await tx.$queryRawUnsafe<DbTicketRow[]>(
          `INSERT INTO "Ticket" (
            "id", "type", "status", "priority", "description",
            "equipmentId", "initialDeadline", "currentDeadline",
            "authorId", "assigneeId", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2::"TicketType", 'NEW'::"TicketStatus", $3::"Priority", $4,
            $5, $6, $7,
            $8, $9, NOW(), NOW()
          ) RETURNING *;`,
          id,
          data.type,
          data.priority,
          data.description,
          data.equipmentId,
          initialDeadline,
          initialDeadline,
          data.authorId,
          data.assigneeId ?? null,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO "TicketAuditLog" (
            "id", "ticketId", "authorId", "action", "comment", "createdAt"
          ) VALUES (
            $1, $2, $3, 'CREATED'::"AuditAction", $4, NOW()
          );`,
          auditId,
          id,
          data.authorId,
          "Заявка создана",
        );

        if (data.assigneeId) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "TicketAuditLog" (
              "id", "ticketId", "authorId", "action", "fieldName", "oldValue", "newValue", "comment", "createdAt"
            ) VALUES (
              $1, $2, $3, 'ASSIGNED'::"AuditAction", 'assigneeId', NULL, $4, $5, NOW()
            );`,
            randomUUID(),
            id,
            data.authorId,
            data.assigneeId,
            "Первоначальное назначение исполнителя",
          );
        }

        const auditRows = await tx.$queryRawUnsafe<DbAuditRow[]>(
          `SELECT * FROM "TicketAuditLog" WHERE "ticketId" = $1 ORDER BY "createdAt" ASC;`,
          id,
        );

        return this.mapToTicketWithDetails(inserted[0]!, auditRows);
      });
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
      const rows = await this.db.$queryRawUnsafe<DbTicketRow[]>(
        `SELECT * FROM "Ticket" WHERE "id" = $1;`,
        id,
      );
      if (!rows || rows.length === 0) return null;
      const auditRows = await this.db.$queryRawUnsafe<DbAuditRow[]>(
        `SELECT * FROM "TicketAuditLog" WHERE "ticketId" = $1 ORDER BY "createdAt" ASC;`,
        id,
      );
      return this.mapToTicketWithDetails(rows[0]!, auditRows);
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
      let query = `SELECT * FROM "Ticket" WHERE 1=1`;
      const params: unknown[] = [];

      if (filters?.status !== undefined) {
        params.push(filters.status);
        query += ` AND "status" = $${params.length}::"TicketStatus"`;
      }
      if (filters?.type !== undefined) {
        params.push(filters.type);
        query += ` AND "type" = $${params.length}::"TicketType"`;
      }
      if (filters?.assigneeId !== undefined) {
        params.push(filters.assigneeId);
        query += ` AND "assigneeId" = $${params.length}`;
      }
      if (filters?.isOverdue === true) {
        query += ` AND "status" != 'COMPLETED'::"TicketStatus" AND "currentDeadline" < NOW()`;
      } else if (filters?.isOverdue === false) {
        query += ` AND ("status" = 'COMPLETED'::"TicketStatus" OR "currentDeadline" >= NOW())`;
      }

      query += ` ORDER BY "ticketNumber" ASC`;

      const rows = await this.db.$queryRawUnsafe<DbTicketRow[]>(query, ...params);
      const result: TicketWithDetails[] = [];
      for (const row of rows) {
        const auditRows = await this.db.$queryRawUnsafe<DbAuditRow[]>(
          `SELECT * FROM "TicketAuditLog" WHERE "ticketId" = $1 ORDER BY "createdAt" ASC;`,
          row.id,
        );
        result.push(this.mapToTicketWithDetails(row, auditRows));
      }
      return result;
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
        const existingRows = await tx.$queryRawUnsafe<DbTicketRow[]>(
          `SELECT * FROM "Ticket" WHERE "id" = $1 FOR UPDATE;`,
          id,
        );
        if (!existingRows || existingRows.length === 0) return null;
        const existing = existingRows[0]!;

        const setClauses: string[] = ['"updatedAt" = NOW()'];
        const params: unknown[] = [id];

        if (updates.status !== undefined) {
          params.push(updates.status);
          setClauses.push(`"status" = $${params.length}::"TicketStatus"`);
        }
        if (updates.type !== undefined) {
          params.push(updates.type);
          setClauses.push(`"type" = $${params.length}::"TicketType"`);
        }
        if (updates.priority !== undefined) {
          params.push(updates.priority);
          setClauses.push(`"priority" = $${params.length}::"Priority"`);
        }
        if (updates.assigneeId !== undefined) {
          params.push(updates.assigneeId);
          setClauses.push(`"assigneeId" = $${params.length}`);
        }
        if (updates.currentDeadline !== undefined) {
          params.push(updates.currentDeadline ? new Date(updates.currentDeadline) : null);
          setClauses.push(`"currentDeadline" = $${params.length}`);
        }
        if (updates.completionComment !== undefined) {
          params.push(updates.completionComment);
          setClauses.push(`"completionComment" = $${params.length}`);
        }
        if (updates.completedAt !== undefined) {
          params.push(updates.completedAt ? new Date(updates.completedAt) : null);
          setClauses.push(`"completedAt" = $${params.length}`);
        }

        await tx.$executeRawUnsafe(
          `UPDATE "Ticket" SET ${setClauses.join(", ")} WHERE "id" = $1;`,
          ...params,
        );

        for (const entry of entries) {
          const action = entry.action === "TYPE_CHANGED" ? "COMMENT_ADDED" : entry.action;
          await tx.$executeRawUnsafe(
            `INSERT INTO "TicketAuditLog" (
              "id", "ticketId", "authorId", "action", "fieldName", "oldValue", "newValue", "comment", "createdAt"
            ) VALUES (
              $1, $2, $3, $4::"AuditAction", $5, $6, $7, $8, NOW()
            );`,
            randomUUID(),
            id,
            entry.authorId ?? existing.authorId,
            action,
            entry.fieldName ?? null,
            entry.oldValue ? String(entry.oldValue) : null,
            entry.newValue ? String(entry.newValue) : null,
            entry.comment ?? null,
          );
        }

        const updatedRows = await tx.$queryRawUnsafe<DbTicketRow[]>(
          `SELECT * FROM "Ticket" WHERE "id" = $1;`,
          id,
        );
        const auditRows = await tx.$queryRawUnsafe<DbAuditRow[]>(
          `SELECT * FROM "TicketAuditLog" WHERE "ticketId" = $1 ORDER BY "createdAt" ASC;`,
          id,
        );

        return this.mapToTicketWithDetails(updatedRows[0]!, auditRows);
      });
    }

    const existing = this.inMemoryTickets.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updatedTicket: Ticket = {
      ...existing,
      ...updates,
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

  async getOverdue(): Promise<TicketWithDetails[]> {
    return this.findMany({ isOverdue: true });
  }

  async getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>> {
    if (this.db) {
      const rows = await this.db.$queryRawUnsafe<DbWorkloadRow[]>(
        `SELECT "assigneeId", COUNT(*)::int AS count
         FROM "Ticket"
         WHERE "status" != 'COMPLETED'::"TicketStatus" AND "assigneeId" IS NOT NULL
         GROUP BY "assigneeId";`,
      );

      return rows.map((r) => ({
        engineerId: r.assigneeId,
        activeTicketsCount: Number(r.count),
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
