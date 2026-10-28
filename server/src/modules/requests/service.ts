import type { Request } from "express";
import type { Database } from "../../database.ts";
import { ApiError } from "../../http/problem.ts";
import type { AuthService } from "../auth/service.ts";
import type { IRequestsRepository } from "./repository.ts";
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

export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "Требуется авторизация.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export interface CreateTicketServiceInput {
  type: "INSPECTION" | "REPAIR";
  equipmentId: string;
  description: string;
  priority: Priority;
  initialDeadline: string;
  assigneeId?: string | undefined;
}

export class RequestsService {
  private repo: IRequestsRepository;
  private db?: Database | undefined;
  private auth?: AuthService | undefined;

  constructor(repo: IRequestsRepository, db?: Database, auth?: AuthService) {
    this.repo = repo;
    this.db = db;
    this.auth = auth;
  }

  getCaller(req: Request): CallerContext {
    const user = this.auth?.authenticate(req.headers.authorization);
    if (user) {
      return { userId: user.id, role: user.role };
    }
    return { userId: null, role: "ANONYMOUS" };
  }

  assertRole(caller: CallerContext, allowedRoles: UserRole[], actionDescription: string): void {
    if (caller.role === "ANONYMOUS") {
      throw new UnauthorizedError("Требуется авторизация для выполнения действия.");
    }
    if (!allowedRoles.includes(caller.role)) {
      throw new ForbiddenError(
        `Действие '${actionDescription}' запрещено для роли '${caller.role}'. Требуется одна из ролей: ${allowedRoles.join(", ")}.`,
      );
    }
  }

  private async validateAssignee(assigneeId: string): Promise<void> {
    if (this.db?.user) {
      const user = await this.db.user.findUnique({
        where: { id: assigneeId },
      });
      if (!user) {
        throw new ApiError(400, `Пользователь с идентификатором '${assigneeId}' не найден.`);
      }
      if (user.role !== "ENGINEER") {
        throw new ApiError(
          400,
          `Назначение отклонено: пользователь '${assigneeId}' имеет роль '${user.role}', а исполнителем заявки может быть только пользователь с ролью 'ENGINEER'.`,
        );
      }
    }
  }

  async createTicket(
    input: CreateTicketServiceInput,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    this.assertRole(caller, ["DUTY", "DIRECTOR"], "Создание заявки");
    if (!caller.userId) {
      throw new UnauthorizedError("Пользователь не идентифицирован.");
    }

    const deadlineMs = new Date(input.initialDeadline).getTime();
    if (Number.isNaN(deadlineMs) || deadlineMs < Date.now()) {
      throw new ApiError(400, "Срок не может быть в прошлом.");
    }

    if (this.db?.equipment) {
      const equipment = await this.db.equipment.findUnique({
        where: { id: input.equipmentId },
      });
      if (!equipment) {
        throw new ApiError(
          400,
          `Оборудование с идентификатором '${input.equipmentId}' не найдено в реестре.`,
        );
      }
    }

    if (input.assigneeId) {
      await this.validateAssignee(input.assigneeId);
    }

    return this.repo.create({
      type: input.type,
      equipmentId: input.equipmentId,
      description: input.description,
      priority: input.priority,
      initialDeadline: input.initialDeadline,
      assigneeId: input.assigneeId,
      authorId: caller.userId,
    });
  }

  async getTicket(id: string, caller?: CallerContext): Promise<TicketWithDetails> {
    if (caller) {
      this.assertRole(caller, ["DUTY", "ENGINEER", "DIRECTOR"], "Просмотр карточки заявки");
    }
    const ticket = await this.repo.findById(id);
    if (!ticket) {
      throw new ApiError(404, `Заявка с идентификатором '${id}' не найдена.`);
    }
    return ticket;
  }

  async listTickets(
    filters: {
      status?: TicketStatus | undefined;
      type?: "INSPECTION" | "REPAIR" | undefined;
      assigneeId?: string | undefined;
      isOverdue?: boolean | undefined;
    },
    caller: CallerContext,
  ): Promise<TicketWithDetails[]> {
    this.assertRole(caller, ["DUTY", "ENGINEER", "DIRECTOR"], "Просмотр списка заявок");
    return this.repo.findMany(filters);
  }

  async assignEngineer(
    ticketId: string,
    assigneeId: string,
    comment: string | undefined,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    this.assertRole(caller, ["DUTY", "DIRECTOR"], "Назначение исполнителя");
    await this.validateAssignee(assigneeId);

    return this.repo.mutate(ticketId, async (existing) => {
      if (existing.status === "COMPLETED") {
        throw new ApiError(400, "Нельзя переназначать исполнителя для уже завершённой заявки.");
      }

      return {
        updates: { assigneeId },
        auditEntries: {
          action: "ASSIGNED",
          fieldName: "assigneeId",
          oldValue: existing.assigneeId,
          newValue: assigneeId,
          comment: comment ?? "Назначен исполнитель",
          authorId: caller.userId,
        },
      };
    });
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

    return this.repo.mutate(ticketId, async (existing) => {
      if (existing.status === "COMPLETED") {
        throw new ApiError(400, "Нельзя изменять срок или приоритет завершённой заявки.");
      }

      const updates: Partial<TicketWithDetails> = {};
      const auditEntries = [];

      if (params.currentDeadline !== undefined) {
        updates.currentDeadline = params.currentDeadline;
        auditEntries.push({
          action: "DEADLINE_CHANGED" as const,
          fieldName: "currentDeadline",
          oldValue: existing.currentDeadline,
          newValue: params.currentDeadline,
          comment: params.comment ?? null,
          authorId: caller.userId,
        });
      }

      if (params.priority !== undefined) {
        updates.priority = params.priority;
        auditEntries.push({
          action: "PRIORITY_CHANGED" as const,
          fieldName: "priority",
          oldValue: existing.priority,
          newValue: params.priority,
          comment: params.comment ?? null,
          authorId: caller.userId,
        });
      }

      return { updates, auditEntries };
    });
  }

  async transitionStatus(
    ticketId: string,
    toStatus: TicketStatus,
    comment: string | undefined,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    const trimmedComment = comment?.trim();

    return this.repo.mutate(ticketId, async (existing) => {
      if (existing.status === "COMPLETED") {
        this.assertRole(caller, ["DUTY", "DIRECTOR"], "Переоткрытие заявки");
        if (!existing.assigneeId) {
          throw new ApiError(
            400,
            "Нельзя возобновить работу по заявке без назначенного исполнителя.",
          );
        }
      } else {
        this.assertRole(caller, ["ENGINEER"], "Смена статуса заявки");
        if (!existing.assigneeId) {
          throw new ApiError(
            400,
            "Нельзя начать или изменить статус заявки без назначенного исполнителя.",
          );
        }
        if (caller.userId !== existing.assigneeId) {
          throw new ForbiddenError("Действие доступно только назначенному на заявку инженеру.");
        }
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

      return {
        updates,
        auditEntries: {
          action: "STATUS_CHANGED",
          fieldName: "status",
          oldValue: existing.status,
          newValue: toStatus,
          comment: trimmedComment ?? null,
          authorId: caller.userId,
        },
      };
    });
  }

  async convertToRepair(
    ticketId: string,
    comment: string,
    caller: CallerContext,
  ): Promise<TicketWithDetails> {
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      throw new ApiError(400, "Требуется обоснование перевода осмотра в ремонт.");
    }

    return this.repo.mutate(ticketId, async (existing) => {
      this.assertRole(caller, ["ENGINEER"], "Перевод осмотра в ремонт");

      if (!existing.assigneeId) {
        throw new ApiError(400, "Нельзя перевести осмотр в ремонт без назначенного исполнителя.");
      }
      if (caller.userId !== existing.assigneeId) {
        throw new ForbiddenError(
          "Перевод осмотра в ремонт доступен только назначенному на заявку инженеру.",
        );
      }

      if (existing.type !== "INSPECTION") {
        throw new ApiError(400, "Перевод в ремонт возможен только для заявок вида 'INSPECTION'.");
      }
      if (existing.status === "COMPLETED") {
        throw new ApiError(400, "Нельзя изменить вид завершённой заявки.");
      }

      return {
        updates: { type: "REPAIR" },
        auditEntries: {
          action: "TYPE_CHANGED",
          fieldName: "type",
          oldValue: "INSPECTION",
          newValue: "REPAIR",
          comment: trimmedComment,
          authorId: caller.userId,
        },
      };
    });
  }

  async getOverdueTickets(caller: CallerContext): Promise<TicketWithDetails[]> {
    this.assertRole(caller, ["DUTY", "ENGINEER", "DIRECTOR"], "Просмотр просроченных заявок");
    return this.repo.getOverdue();
  }

  async getWorkload(
    caller: CallerContext,
  ): Promise<Array<{ engineerId: string; activeTicketsCount: number }>> {
    this.assertRole(caller, ["DUTY", "ENGINEER", "DIRECTOR"], "Просмотр распределения нагрузки");
    return this.repo.getWorkload();
  }
}
