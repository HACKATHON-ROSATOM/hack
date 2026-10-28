import { z } from "zod";
import type { Database } from "../../database.ts";
import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import { RequestsRepository } from "./repository.ts";
import {
  assignRequestSchema,
  convertTypeRequestSchema,
  createRequestSchema,
  noQuerySchema,
  requestListQuerySchema,
  requestParamsSchema,
  scheduleRequestSchema,
  ticketDetailResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
  transitionRequestSchema,
  workloadListResponseSchema,
} from "./schemas.ts";
import type { ErrorRequestHandler } from "express";
import { ForbiddenError, RequestsService } from "./service.ts";

const basePath = "/api/requests";

export function createRequestsModule(db?: Database, customService?: RequestsService): ApiModule {
  const module = createApiModule();
  const repository = new RequestsRepository(db);
  const service = customService ?? new RequestsService(repository);

  module.register(
    {
      method: "post",
      path: basePath,
      operationId: "createRequest",
      summary: "Создать ручную заявку на осмотр или ремонт",
      description:
        "Создание новой заявки. Доступно для Дежурного (DUTY). Проверяется тип, описание и первоначальный срок.",
      request: {
        query: noQuerySchema,
        body: {
          required: true,
          content: {
            "application/json": { schema: createRequestSchema },
          },
        },
      },
      responses: {
        201: {
          description: "Заявка успешно создана.",
          headers: z.object({
            Location: z.string().meta({
              description: "Ссылка на созданную заявку",
              example: `${basePath}/8e5c7ee2-5f05-4f40-b6a2-c62bce1c5328`,
            }),
          }),
          content: { "application/json": { schema: ticketResponseSchema } },
        },
        400: problemResponse("Невалидный формат тела запроса или параметров."),
        403: problemResponse("Запрещено для текущей роли (требуется DUTY)."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) {
        throw new ApiError(415, "Expected application/json content-type.");
      }
      if (!noQuerySchema.safeParse(req.query).success) {
        throw new ApiError(400, "Query parameters are not supported for creation.");
      }
      const body = createRequestSchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(
          400,
          `Validation failed: ${body.error.issues.map((i) => i.message).join(", ")}`,
        );
      }

      const caller = service.getCaller(req);
      const created = await service.createTicket(body.data, caller);
      const { auditLogs: _unusedLogs, ...summary } = created;
      res.location(`${basePath}/${created.id}`).status(201).json(summary);
    },
  );

  module.register(
    {
      method: "get",
      path: basePath,
      operationId: "listRequests",
      summary: "Получить список заявок",
      description:
        "Возвращает список заявок с возможностью фильтрации по статусу, исполнителю, виду и признаку просрочки.",
      request: {
        query: requestListQuerySchema,
      },
      responses: {
        200: {
          description: "Список заявок.",
          content: { "application/json": { schema: ticketListResponseSchema } },
        },
        400: problemResponse("Некорректные параметры фильтрации."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      const query = requestListQuerySchema.safeParse(req.query);
      if (!query.success) {
        throw new ApiError(400, "Invalid query parameters.");
      }

      const filters = {
        status: query.data.status,
        type: query.data.type,
        assigneeId: query.data.assigneeId,
        isOverdue: query.data.isOverdue !== undefined ? query.data.isOverdue === "true" : undefined,
      };

      const tickets = await service.listTickets(filters);
      const summaries = tickets.map(({ auditLogs: _unused, ...summary }) => summary);
      res.json({ items: summaries });
    },
  );

  module.register(
    {
      method: "get",
      path: `${basePath}/analytics/overdue`,
      operationId: "getOverdueRequests",
      summary: "Получить список просроченных заявок",
      description:
        "Возвращает незавершённые заявки, у которых плановый срок меньше текущего времени.",
      request: {
        query: noQuerySchema,
      },
      responses: {
        200: {
          description: "Список просроченных заявок.",
          content: { "application/json": { schema: ticketListResponseSchema } },
        },
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (_req, res) => {
      const tickets = await service.getOverdueTickets();
      const summaries = tickets.map(({ auditLogs: _unused, ...summary }) => summary);
      res.json({ items: summaries });
    },
  );

  module.register(
    {
      method: "get",
      path: `${basePath}/analytics/workload`,
      operationId: "getEngineersWorkload",
      summary: "Получить распределение нагрузки инженеров",
      description:
        "Возвращает количество активных незавершённых заявок по каждому сервисному инженеру.",
      request: {
        query: noQuerySchema,
      },
      responses: {
        200: {
          description: "Нагрузка инженеров.",
          content: { "application/json": { schema: workloadListResponseSchema } },
        },
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (_req, res) => {
      const workload = await service.getWorkload();
      res.json({ items: workload });
    },
  );

  module.register(
    {
      method: "get",
      path: `${basePath}/{id}`,
      operationId: "getRequestById",
      summary: "Получить карточку заявки с журналом аудита",
      description:
        "Возвращает полную карточку заявки, включая все исторические записи журнала изменений.",
      request: {
        params: requestParamsSchema,
        query: noQuerySchema,
      },
      responses: {
        200: {
          description: "Карточка заявки с историей изменений.",
          content: { "application/json": { schema: ticketDetailResponseSchema } },
        },
        400: problemResponse("Некорректный UUID заявки."),
        404: problemResponse("Заявка не найдена."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      const params = requestParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Invalid ticket UUID.");
      const ticket = await service.getTicket(params.data.id);
      res.json(ticket);
    },
  );

  module.register(
    {
      method: "patch",
      path: `${basePath}/{id}/assignment`,
      operationId: "assignRequestEngineer",
      summary: "Назначить или переназначить инженера",
      description: "Назначение исполнителя заявки (Дежурный или Технический директор).",
      request: {
        params: requestParamsSchema,
        query: noQuerySchema,
        body: {
          required: true,
          content: { "application/json": { schema: assignRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Исполнитель успешно назначен.",
          content: { "application/json": { schema: ticketDetailResponseSchema } },
        },
        400: problemResponse("Невалидные данные."),
        403: problemResponse("Запрещено для текущей роли."),
        404: problemResponse("Заявка не найдена."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) throw new ApiError(415, "Expected application/json.");
      const params = requestParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Invalid ticket UUID.");
      const body = assignRequestSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, "Invalid body.");

      const caller = service.getCaller(req);
      const updated = await service.assignEngineer(
        params.data.id,
        body.data.assigneeId,
        body.data.comment,
        caller,
      );
      res.json(updated);
    },
  );

  module.register(
    {
      method: "patch",
      path: `${basePath}/{id}/schedule`,
      operationId: "updateRequestSchedule",
      summary: "Изменить плановый срок или приоритет",
      description: "Изменение срока выполнения и приоритета (Технический директор).",
      request: {
        params: requestParamsSchema,
        query: noQuerySchema,
        body: {
          required: true,
          content: { "application/json": { schema: scheduleRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Срок или приоритет изменён.",
          content: { "application/json": { schema: ticketDetailResponseSchema } },
        },
        400: problemResponse("Невалидные данные."),
        403: problemResponse("Запрещено для текущей роли."),
        404: problemResponse("Заявка не найдена."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) throw new ApiError(415, "Expected application/json.");
      const params = requestParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Invalid ticket UUID.");
      const body = scheduleRequestSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, "Invalid body.");

      const caller = service.getCaller(req);
      const updated = await service.updateSchedule(params.data.id, body.data, caller);
      res.json(updated);
    },
  );

  module.register(
    {
      method: "post",
      path: `${basePath}/{id}/transitions`,
      operationId: "transitionRequestStatus",
      summary: "Смена статуса заявки (State Machine)",
      description:
        "Перевод заявки: NEW -> IN_PROGRESS -> COMPLETED или IN_PROGRESS <-> WAITING_PARTS. При COMPLETED обязателен непустой комментарий.",
      request: {
        params: requestParamsSchema,
        query: noQuerySchema,
        body: {
          required: true,
          content: { "application/json": { schema: transitionRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Статус успешно изменён.",
          content: { "application/json": { schema: ticketDetailResponseSchema } },
        },
        400: problemResponse("Недопустимый переход или пустой комментарий при закрытии."),
        403: problemResponse("Запрещено для текущей роли (требуется ENGINEER)."),
        404: problemResponse("Заявка не найдена."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) throw new ApiError(415, "Expected application/json.");
      const params = requestParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Invalid ticket UUID.");
      const body = transitionRequestSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, "Invalid transition body.");

      const caller = service.getCaller(req);
      const updated = await service.transitionStatus(
        params.data.id,
        body.data.toStatus,
        body.data.comment,
        caller,
      );
      res.json(updated);
    },
  );

  module.register(
    {
      method: "post",
      path: `${basePath}/{id}/convert-to-repair`,
      operationId: "convertInspectionToRepair",
      summary: "Перевести заявку с осмотра на ремонт",
      description: "Перевод заявки вида INSPECTION в REPAIR инженером при обнаружении дефектов.",
      request: {
        params: requestParamsSchema,
        query: noQuerySchema,
        body: {
          required: true,
          content: { "application/json": { schema: convertTypeRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Заявка успешно переведена в ремонт.",
          content: { "application/json": { schema: ticketDetailResponseSchema } },
        },
        400: problemResponse("Невозможно перевести в ремонт."),
        403: problemResponse("Запрещено для текущей роли (требуется ENGINEER)."),
        404: problemResponse("Заявка не найдена."),
        500: problemResponse("Внутренняя ошибка сервера."),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) throw new ApiError(415, "Expected application/json.");
      const params = requestParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Invalid ticket UUID.");
      const body = convertTypeRequestSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, "Invalid body.");

      const caller = service.getCaller(req);
      const updated = await service.convertToRepair(params.data.id, body.data.comment, caller);
      res.json(updated);
    },
  );

  const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    if (error instanceof ForbiddenError) {
      res
        .status(403)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Forbidden",
          status: 403,
          detail: error.message,
          instance: req.originalUrl.split("?")[0],
        });
      return;
    }
    next(error);
  };
  module.router.use(errorHandler);

  return module;
}
