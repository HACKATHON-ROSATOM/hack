import { randomUUID } from "node:crypto";
import type { Database } from "../../database.ts";
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
  initialDeadline?: string | undefined;
  assigneeId?: string | undefined;
  authorId?: string | undefined;
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
  create(data: CreateTicketData): Promise<Ticket>;
  findById(id: string): Promise<TicketWithDetails | null>;
  findMany(filters?: TicketFilters): Promise<TicketWithDetails[]>;
  update(
    id: string,
    updates: Partial<Ticket>,
    audit: AuditEntryData,
  ): Promise<TicketWithDetails | null>;
  getOverdue(): Promise<TicketWithDetails[]>;
  getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>>;
}

interface RawDbAuditLog {
  id: string;
  ticketId: string;
  authorId: string | null;
  action: AuditAction;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: Date;
}

interface RawDbRecord {
  id: string;
  ticketNumber: number;
  type: TicketType;
  source: TicketSource;
  status: TicketStatus;
  priority: Priority;
  equipmentId: string;
  authorId: string | null;
  assigneeId: string | null;
  description: string;
  initialDeadline: Date | null;
  currentDeadline: Date | null;
  completionComment: string | null;
  createdAt: Date;
  completedAt: Date | null;
  version: number;
  auditLogs?: RawDbAuditLog[];
}

interface DynamicPrismaTx {
  ticket: {
    create: (args: { data: Record<string, unknown> }) => Promise<RawDbRecord>;
  };
  ticketAuditLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
}

interface DynamicPrismaClient {
  $transaction: <T>(fn: (tx: DynamicPrismaTx) => Promise<T>) => Promise<T>;
  ticket: {
    findUnique: (args: {
      where: { id: string };
      include: { auditLogs: { orderBy: { createdAt: "asc" } } };
    }) => Promise<RawDbRecord | null>;
  };
}

export class RequestsRepository implements IRequestsRepository {
  private inMemoryTickets = new Map<string, Ticket>();
  private inMemoryAudit = new Map<string, TicketAuditLog[]>();
  private nextSequence = 1;
  private db?: Database | undefined;

  constructor(db?: Database) {
    this.db = db;
  }

  private isDbAvailable(): boolean {
    const client = this.db as unknown as { ticket?: { create?: unknown } };
    return Boolean(client && client.ticket && typeof client.ticket.create === "function");
  }

  private isOverdue(ticket: Ticket): boolean {
    if (ticket.status === "COMPLETED") return false;
    if (!ticket.currentDeadline) return false;
    return new Date(ticket.currentDeadline).getTime() < Date.now();
  }

  async create(data: CreateTicketData): Promise<Ticket> {
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
      authorId: data.authorId ?? null,
      assigneeId: data.assigneeId ?? null,
      description: data.description,
      initialDeadline: data.initialDeadline ?? null,
      currentDeadline: data.initialDeadline ?? null,
      completionComment: null,
      createdAt: now,
      completedAt: null,
      version: 1,
    };

    const initialAudit: TicketAuditLog = {
      id: randomUUID(),
      ticketId: id,
      authorId: data.authorId ?? null,
      action: "CREATED",
      fieldName: null,
      oldValue: null,
      newValue: null,
      comment: "Заявка создана",
      createdAt: now,
    };

    if (this.isDbAvailable()) {
      try {
        const client = this.db as unknown as DynamicPrismaClient;
        return await client.$transaction(async (tx) => {
          const created = await tx.ticket.create({
            data: {
              id: ticket.id,
              ticketNumber: ticket.ticketNumber,
              type: ticket.type,
              source: ticket.source,
              status: ticket.status,
              priority: ticket.priority,
              equipmentId: ticket.equipmentId,
              authorId: ticket.authorId,
              assigneeId: ticket.assigneeId,
              description: ticket.description,
              initialDeadline: ticket.initialDeadline ? new Date(ticket.initialDeadline) : null,
              currentDeadline: ticket.currentDeadline ? new Date(ticket.currentDeadline) : null,
              createdAt: new Date(ticket.createdAt),
              version: ticket.version,
            },
          });

          await tx.ticketAuditLog.create({
            data: {
              id: initialAudit.id,
              ticketId: initialAudit.ticketId,
              authorId: initialAudit.authorId,
              action: initialAudit.action,
              comment: initialAudit.comment,
              createdAt: new Date(initialAudit.createdAt),
            },
          });

          return {
            ...created,
            initialDeadline: created.initialDeadline?.toISOString() ?? null,
            currentDeadline: created.currentDeadline?.toISOString() ?? null,
            createdAt: created.createdAt.toISOString(),
            completedAt: created.completedAt?.toISOString() ?? null,
          };
        });
      } catch {
        // Fallback to in-memory store
      }
    }

    this.inMemoryTickets.set(id, ticket);
    this.inMemoryAudit.set(id, [initialAudit]);
    return ticket;
  }

  async findById(id: string): Promise<TicketWithDetails | null> {
    if (this.isDbAvailable()) {
      try {
        const client = this.db as unknown as DynamicPrismaClient;
        const record = await client.ticket.findUnique({
          where: { id },
          include: { auditLogs: { orderBy: { createdAt: "asc" } } },
        });
        if (record) {
          const ticket: Ticket = {
            ...record,
            initialDeadline: record.initialDeadline?.toISOString() ?? null,
            currentDeadline: record.currentDeadline?.toISOString() ?? null,
            createdAt: record.createdAt.toISOString(),
            completedAt: record.completedAt?.toISOString() ?? null,
          };
          return {
            ...ticket,
            isOverdue: this.isOverdue(ticket),
            auditLogs: (record.auditLogs ?? []).map((log) => ({
              ...log,
              createdAt: log.createdAt.toISOString(),
            })),
          };
        }
      } catch {
        // Fallback to in-memory
      }
    }

    const ticket = this.inMemoryTickets.get(id);
    if (!ticket) return null;
    const auditLogs = this.inMemoryAudit.get(id) ?? [];
    return {
      ...ticket,
      isOverdue: this.isOverdue(ticket),
      auditLogs,
    };
  }

  async findMany(filters?: TicketFilters): Promise<TicketWithDetails[]> {
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
      tickets = tickets.filter((t) => this.isOverdue(t) === filters.isOverdue);
    }

    return tickets.map((t) => ({
      ...t,
      isOverdue: this.isOverdue(t),
      auditLogs: this.inMemoryAudit.get(t.id) ?? [],
    }));
  }

  async update(
    id: string,
    updates: Partial<Ticket>,
    audit: AuditEntryData,
  ): Promise<TicketWithDetails | null> {
    const existing = this.inMemoryTickets.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updatedTicket: Ticket = {
      ...existing,
      ...updates,
      version: existing.version + 1,
    };

    const auditLogEntry: TicketAuditLog = {
      id: randomUUID(),
      ticketId: id,
      authorId: audit.authorId ?? null,
      action: audit.action,
      fieldName: audit.fieldName ?? null,
      oldValue: audit.oldValue ?? null,
      newValue: audit.newValue ?? null,
      comment: audit.comment ?? null,
      createdAt: now,
    };

    this.inMemoryTickets.set(id, updatedTicket);
    const existingLogs = this.inMemoryAudit.get(id) ?? [];
    existingLogs.push(auditLogEntry);
    this.inMemoryAudit.set(id, existingLogs);

    return {
      ...updatedTicket,
      isOverdue: this.isOverdue(updatedTicket),
      auditLogs: existingLogs,
    };
  }

  async getOverdue(): Promise<TicketWithDetails[]> {
    return this.findMany({ isOverdue: true });
  }

  async getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>> {
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
