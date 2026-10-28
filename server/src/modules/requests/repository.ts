import { randomUUID } from "node:crypto";
import type { Database } from "../../database.ts";
import { ApiError } from "../../http/problem.ts";
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
  private nextSequence = 1;

  constructor(db?: Database) {
    this.db = db;
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
    status: TicketStatus;
    priority: Priority;
    equipmentId: string;
    authorId: string;
    assigneeId: string | null;
    description: string;
    initialDeadline: Date;
    currentDeadline: Date;
    completionComment: string | null;
    createdAt: Date;
    completedAt: Date | null;
    auditLogs?: Array<{
      id: string;
      ticketId: string;
      authorId: string;
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
      source: "MANUAL",
      status: ticket.status,
      priority: ticket.priority,
      equipmentId: ticket.equipmentId,
      authorId: ticket.authorId,
      assigneeId: ticket.assigneeId,
      description: ticket.description,
      initialDeadline: ticket.initialDeadline.toISOString(),
      currentDeadline: ticket.currentDeadline.toISOString(),
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
            OR: [{ status: "COMPLETED" as const }, { currentDeadline: { gte: new Date() } }],
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
          currentDeadline?: Date;
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
              authorId: entry.authorId ?? existing.authorId,
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
        if (updates.currentDeadline) {
          updateData.currentDeadline = new Date(updates.currentDeadline);
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
          currentDeadline?: Date;
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
              authorId: entry.authorId ?? existingRecord.authorId,
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
        if (updates.currentDeadline) {
          updateData.currentDeadline = new Date(updates.currentDeadline);
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
