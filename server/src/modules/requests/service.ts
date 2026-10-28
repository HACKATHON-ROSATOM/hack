import type { Request } from "express";
import createError from "http-errors";
import { ApiError } from "../../http/problem.ts";
import type { IRequestsRepository } from "./repository.ts";
import type { CreateTicketData, TicketFilters } from "./repository.ts";
import type { Priority, TicketStatus, TicketWithDetails, UserRole } from "./types.ts";

export interface CallerContext {
  userId: string | null;
  role: UserRole;
}

export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class RequestsService {
  private repo: IRequestsRepository;

  constructor(repo: IRequestsRepository) {
    this.repo = repo;
  }

  /**
   * Извлечение контекста пользователя из запроса.
   * Поддерживает заголовки X-User-Role и X-User-Id.
   */
  getCaller(req: Request): CallerContext {
    const rawRole = req.headers["x-user-role"];
    const role: UserRole =
      typeof rawRole === "string" &&
      ["DUTY", "ENGINEER", "DIRECTOR"].includes(rawRole.toUpperCase())
        ? (rawRole.toUpperCase() as UserRole)
        : "ANONYMOUS";

    const rawId = req.headers["x-user-id"];
    const userId = typeof rawId === "string" ? rawId : null;

    return { userId, role };
  }

  assertRole(caller: CallerContext, allowedRoles: UserRole[], actionDescription: string): void {
    if (!allowedRoles.includes(caller.role)) {
      throw new ForbiddenError(
        `Действие '${actionDescription}' запрещено для роли '${caller.role}'. Требуется одна из ролей: ${allowedRoles.join(", ")}.`,
      );
    }
  }

  async createTicket(input: CreateTicketData, caller: CallerContext): Promise<TicketWithDetails> {
    this.assertRole(caller, ["DUTY", "DIRECTOR"], "Создание заявки");

    const ticket = await this.repo.create({
      type: input.type,
      equipmentId: input.equipmentId,
      description: input.description,
      priority: input.priority,
      initialDeadline: input.initialDeadline,
      assigneeId: input.assigneeId,
      authorId: caller.userId ?? undefined,
    });

    const full = await this.repo.findById(ticket.id);
    if (!full) throw createError(500, "Failed to retrieve created ticket.");
    return full;
  }

  async getTicket(id: string): Promise<TicketWithDetails> {
    const ticket = await this.repo.findById(id);
    if (!ticket) {
      throw new ApiError(404, `Заявка с идентификатором '${id}' не найдена.`);
    }
    return ticket;
  }

  async listTickets(filters: TicketFilters): Promise<TicketWithDetails[]> {
    return this.repo.findMany(filters);
  }

  async assignEngineer(
    ticketId: string,
    assigneeId: string,
    comment: string | undefined,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    this.assertRole(caller, ["DUTY", "DIRECTOR"], "Назначение исполнителя");

    const existing = await this.getTicket(ticketId);
    if (existing.status === "COMPLETED") {
      throw new ApiError(400, "Нельзя переназначать исполнителя для уже завершённой заявки.");
    }

    const updated = await this.repo.update(
      ticketId,
      { assigneeId },
      {
        action: "ASSIGNED",
        fieldName: "assigneeId",
        oldValue: existing.assigneeId,
        newValue: assigneeId,
        comment: comment ?? "Назначен исполнитель",
        authorId: caller.userId,
      },
    );

    if (!updated) throw new ApiError(404, "Заявка не найдена.");
    return updated;
  }

  async updateSchedule(
    ticketId: string,
    params: {
      currentDeadline?: string | undefined;
      priority?: Priority | undefined;
      comment?: string | undefined;
    },
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    this.assertRole(caller, ["DIRECTOR", "DUTY"], "Изменение срока или приоритета");

    const existing = await this.getTicket(ticketId);
    if (existing.status === "COMPLETED") {
      throw new ApiError(400, "Нельзя изменять срок или приоритет завершённой заявки.");
    }

    const updates: Partial<TicketWithDetails> = {};
    if (params.currentDeadline !== undefined) {
      updates.currentDeadline = params.currentDeadline;
    }
    if (params.priority !== undefined) {
      updates.priority = params.priority;
    }

    const updated = await this.repo.update(ticketId, updates, {
      action: params.currentDeadline ? "DEADLINE_CHANGED" : "PRIORITY_CHANGED",
      fieldName: params.currentDeadline ? "currentDeadline" : "priority",
      oldValue: params.currentDeadline ? existing.currentDeadline : existing.priority,
      newValue: params.currentDeadline ? params.currentDeadline : (params.priority ?? null),
      comment: params.comment ?? "Срок или приоритет изменён",
      authorId: caller.userId,
    });

    if (!updated) throw new ApiError(404, "Заявка не найдена.");
    return updated;
  }

  async transitionStatus(
    ticketId: string,
    toStatus: TicketStatus,
    comment: string | undefined,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    const existing = await this.getTicket(ticketId);

    if (existing.status === "COMPLETED") {
      this.assertRole(caller, ["DUTY", "DIRECTOR"], "Переоткрытие заявки");
    } else {
      this.assertRole(caller, ["ENGINEER"], "Смена статуса заявки");
    }

    const validTransitions: Record<TicketStatus, TicketStatus[]> = {
      NEW: ["IN_PROGRESS"],
      IN_PROGRESS: ["WAITING_PARTS", "COMPLETED"],
      WAITING_PARTS: ["IN_PROGRESS"],
      COMPLETED: ["IN_PROGRESS"],
    };

    const allowed = validTransitions[existing.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ApiError(
        400,
        `Недопустимый переход статуса из '${existing.status}' в '${toStatus}'. Разрешённые переходы: [${allowed.join(", ")}].`,
      );
    }

    const trimmedComment = comment?.trim();
    if (existing.status === "COMPLETED" && toStatus === "IN_PROGRESS" && !trimmedComment) {
      throw new ApiError(400, "Для переоткрытия заявки требуется указать причину.");
    }

    if (toStatus === "COMPLETED" && !trimmedComment) {
      throw new ApiError(
        400,
        "Закрытие заявки отклонено: требуется обязательный непустой комментарий о результатах работы.",
      );
    }

    const now = new Date().toISOString();
    const isReopen = existing.status === "COMPLETED" && toStatus === "IN_PROGRESS";
    const updates: Partial<TicketWithDetails> = {
      status: toStatus,
      completedAt: toStatus === "COMPLETED" ? now : isReopen ? null : existing.completedAt,
      completionComment:
        toStatus === "COMPLETED"
          ? (trimmedComment ?? null)
          : isReopen
            ? null
            : existing.completionComment,
    };

    const updated = await this.repo.update(ticketId, updates, {
      action: "STATUS_CHANGED",
      fieldName: "status",
      oldValue: existing.status,
      newValue: toStatus,
      comment: trimmedComment ?? null,
      authorId: caller.userId,
    });

    if (!updated) throw new ApiError(404, "Заявка не найдена.");
    return updated;
  }

  async convertToRepair(
    ticketId: string,
    comment: string,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    this.assertRole(caller, ["ENGINEER"], "Перевод осмотра в ремонт");

    const existing = await this.getTicket(ticketId);
    if (existing.type !== "INSPECTION") {
      throw new ApiError(400, "Перевод в ремонт возможен только для заявок вида 'INSPECTION'.");
    }
    if (existing.status === "COMPLETED") {
      throw new ApiError(400, "Нельзя изменить вид завершённой заявки.");
    }

    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      throw new ApiError(400, "Требуется обоснование перевода осмотра в ремонт.");
    }

    const updated = await this.repo.update(
      ticketId,
      { type: "REPAIR" },
      {
        action: "TYPE_CHANGED",
        fieldName: "type",
        oldValue: "INSPECTION",
        newValue: "REPAIR",
        comment: trimmedComment,
        authorId: caller.userId,
      },
    );

    if (!updated) throw new ApiError(404, "Заявка не найдена.");
    return updated;
  }

  async getOverdueTickets(): Promise<TicketWithDetails[]> {
    return this.repo.getOverdue();
  }

  async getWorkload(): Promise<Array<{ engineerId: string; activeTicketsCount: number }>> {
    return this.repo.getWorkload();
  }
}
