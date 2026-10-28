import { z } from "zod";

export const ticketTypeSchema = z
  .enum(["INSPECTION", "REPAIR"])
  .meta({ id: "TicketType", description: "Вид заявки: осмотр или ремонт." });

export const ticketSourceSchema = z
  .enum(["MANUAL", "AUTO"])
  .meta({ id: "TicketSource", description: "Источник создания заявки." });

export const ticketStatusSchema = z
  .enum(["NEW", "IN_PROGRESS", "WAITING_PARTS", "COMPLETED"])
  .meta({ id: "TicketStatus", description: "Текущий статус жизненного цикла заявки." });

export const prioritySchema = z
  .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
  .meta({ id: "Priority", description: "Приоритет выполнения заявки." });

export const auditActionSchema = z
  .enum([
    "CREATED",
    "STATUS_CHANGED",
    "ASSIGNED",
    "DEADLINE_CHANGED",
    "PRIORITY_CHANGED",
    "TYPE_CHANGED",
    "COMMENT_ADDED",
  ])
  .meta({ id: "AuditAction", description: "Тип совершённого действия в журнале аудита." });

export const createRequestSchema = z
  .strictObject({
    type: ticketTypeSchema,
    equipmentId: z
      .string()
      .uuid()
      .meta({ description: "Идентификатор объекта оборудования (UUID)" }),
    description: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .meta({ description: "Подробное описание проблемы или объёма работ (1–2000 символов)" }),
    priority: prioritySchema.default("MEDIUM"),
    initialDeadline: z.string().datetime().meta({
      description: "Первоначальный плановый срок в формате ISO 8601. Не может быть в прошлом.",
    }),
    assigneeId: z
      .string()
      .uuid()
      .optional()
      .meta({ description: "Идентификатор назначаемого инженера (UUID)" }),
  })
  .meta({
    id: "CreateRequestInput",
    description: "Входные данные для создания новой ручной заявки (Дежурный).",
    example: {
      type: "INSPECTION",
      equipmentId: "8e5c7ee2-5f05-4f40-b6a2-c62bce1c5328",
      description: "Посторонний шум в районе подшипника вала генератора.",
      priority: "HIGH",
      initialDeadline: "2026-10-29T18:00:00.000Z",
    },
  });

export const requestParamsSchema = z
  .strictObject({
    id: z.string().uuid().meta({ description: "Уникальный идентификатор заявки (UUID)" }),
  })
  .meta({ id: "RequestParams", description: "Идентификатор заявки в URL пути." });

export const requestListQuerySchema = z
  .strictObject({
    status: ticketStatusSchema.optional(),
    type: ticketTypeSchema.optional(),
    assigneeId: z.string().uuid().optional(),
    isOverdue: z.enum(["true", "false"]).optional(),
  })
  .meta({ id: "RequestListQuery", description: "Фильтры списка заявок." });

export const noQuerySchema = z.strictObject({}).meta({
  id: "NoQuery",
  description: "Query-параметры не поддерживаются.",
});

export const assignRequestSchema = z
  .strictObject({
    assigneeId: z.string().uuid().meta({ description: "Идентификатор назначаемого инженера" }),
    comment: z.string().trim().max(1000).optional().meta({ description: "Обоснование назначения" }),
  })
  .meta({
    id: "AssignRequestInput",
    description: "Назначение или переназначение исполнителя.",
    example: {
      assigneeId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      comment: "Назначен дежурный инженер смены",
    },
  });

export const scheduleRequestSchema = z
  .strictObject({
    currentDeadline: z.string().datetime().optional().meta({ description: "Новый срок ISO 8601" }),
    priority: prioritySchema.optional().meta({ description: "Новый приоритет" }),
    comment: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .meta({ description: "Причина изменения срока/приоритета" }),
  })
  .refine((data) => data.currentDeadline !== undefined || data.priority !== undefined, {
    message: "Необходимо указать хотя бы одно поле: currentDeadline или priority",
  })
  .meta({
    id: "ScheduleRequestInput",
    description: "Изменение планового срока или приоритета.",
    example: {
      currentDeadline: "2026-10-30T12:00:00.000Z",
      priority: "CRITICAL",
      comment: "Сдвиг по согласованию с техническим директором",
    },
  });

export const transitionRequestSchema = z
  .strictObject({
    toStatus: z
      .enum(["IN_PROGRESS", "WAITING_PARTS", "COMPLETED"])
      .meta({ description: "Целевой статус заявки" }),
    comment: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .meta({ description: "Комментарий (строго обязателен при закрытии заявки)" }),
  })
  .meta({
    id: "TransitionRequestInput",
    description: "Перевод заявки по жизненному циклу.",
    example: {
      toStatus: "COMPLETED",
      comment: "ремонт не потребовался",
    },
  });

export const convertTypeRequestSchema = z
  .strictObject({
    comment: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .meta({ description: "Обоснование перевода осмотра в ремонт" }),
  })
  .meta({
    id: "ConvertTypeRequestInput",
    description: "Перевод заявки с осмотра на ремонт инженером.",
    example: {
      comment: "В ходе осмотра обнаружен износ манжеты, требуется ремонт.",
    },
  });

export const attachSnapshotRequestSchema = z.strictObject({
  turbineNumber: z.number().int().min(1).max(8),
});

export const telemetrySnapshotSchema = z.strictObject({
  turbineId: z.string(),
  turbineNumber: z.number().int(),
  ca: z.number().int(),
  ioa: z.number().int(),
  value: z.number(),
  status: z.enum(["STOPPED", "READY", "RUNNING", "ALARM", "UNKNOWN"]),
  receivedAt: z.string().datetime(),
  fresh: z.boolean(),
});

export const auditLogItemResponseSchema = z
  .strictObject({
    id: z.string().uuid(),
    ticketId: z.string().uuid(),
    action: auditActionSchema,
    fieldName: z.string().nullable(),
    oldValue: z.string().nullable(),
    newValue: z.string().nullable(),
    comment: z.string().nullable(),
    authorId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
  })
  .meta({ id: "AuditLogItem", description: "Запись в журнале изменений заявки." });

export const ticketResponseSchema = z
  .strictObject({
    id: z.string().uuid(),
    ticketNumber: z.number().int(),
    type: ticketTypeSchema,
    source: ticketSourceSchema,
    status: ticketStatusSchema,
    priority: prioritySchema,
    equipmentId: z.string().uuid().nullable(),
    authorId: z.string().uuid().nullable(),
    assigneeId: z.string().uuid().nullable(),
    description: z.string(),
    initialDeadline: z.string().datetime().nullable(),
    currentDeadline: z.string().datetime().nullable(),
    telemetryTurbineId: z.string().nullable(),
    snapshot: telemetrySnapshotSchema.nullable(),
    completionComment: z.string().nullable(),
    isOverdue: z.boolean(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    version: z.number().int().min(1).meta({
      description: "Версия заявки: увеличивается при каждом успешном изменении.",
    }),
  })
  .meta({ id: "TicketSummary", description: "Краткая информация о заявке." });

export const ticketListResponseSchema = z
  .strictObject({
    items: z.array(ticketResponseSchema),
  })
  .meta({ id: "TicketList", description: "Список заявок." });

export const ticketDetailResponseSchema = ticketResponseSchema
  .extend({
    auditLogs: z.array(auditLogItemResponseSchema),
  })
  .meta({ id: "TicketDetail", description: "Полная карточка заявки с журналом аудита." });

export const workloadItemResponseSchema = z
  .strictObject({
    engineerId: z.string().uuid(),
    activeTicketsCount: z.number().int(),
  })
  .meta({
    id: "WorkloadItem",
    description: "Нагрузка конкретного инженера (число активных заявок).",
  });

export const workloadListResponseSchema = z
  .strictObject({
    items: z.array(workloadItemResponseSchema),
  })
  .meta({ id: "WorkloadList", description: "Сводка распределения нагрузки по инженерам." });
