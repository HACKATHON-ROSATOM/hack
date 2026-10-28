import { z } from "zod";

import type { Database } from "../../database.ts";
import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import {
  createNoteSchema,
  noQuerySchema,
  noteParamsSchema,
  noteResponseSchema,
} from "./schemas.ts";

const noteSelect = { id: true, content: true, createdAt: true } as const;
const basePath = "/api/notes";

export function createNotesModule(db: Database): ApiModule {
  const module = createApiModule();

  module.router.use(basePath, (req, _res, next) => {
    if (!noQuerySchema.safeParse(req.query).success) {
      throw new ApiError(400, "Query parameters are not supported.");
    }
    next();
  });

  module.register(
    {
      method: "post",
      path: basePath,
      operationId: "createNote",
      summary: "Создать заметку",
      description:
        "Параметры запроса не поддерживаются. Пробелы по краям текста удаляются перед проверкой длины от 1 до 2000 кодовых точек Unicode. Размер JSON ограничен 16 КиБ.",
      request: {
        query: noQuerySchema,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: createNoteSchema,
              example: { content: "Пример заметки" },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Заметка создана",
          headers: z.object({
            Location: z.string().meta({
              description: "Относительный путь к созданной заметке",
              example: `${basePath}/8e5c7ee2-5f05-4f40-b6a2-c62bce1c5328`,
            }),
          }),
          content: { "application/json": { schema: noteResponseSchema } },
        },
        400: problemResponse(
          "Некорректный JSON, тело запроса, UUID или неожиданные параметры запроса (400)",
        ),
        413: problemResponse("Размер тела запроса превышает 16 КиБ (413)"),
        415: problemResponse(
          "Отсутствует или не поддерживается тип содержимого, кодировка символов или тела запроса (415)",
        ),
        500: problemResponse("Внутренняя ошибка сервера (500)"),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) {
        throw new ApiError(415, "Expected application/json.");
      }
      const body = createNoteSchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(400, "Expected only content containing 1 to 2000 nonblank characters.");
      }
      const note = await db.note.create({ data: body.data, select: noteSelect });
      res.location(`${basePath}/${note.id}`).status(201).json(note);
    },
  );

  module.register(
    {
      method: "get",
      path: `${basePath}/{id}`,
      operationId: "getNote",
      summary: "Получить заметку",
      description:
        "Параметры запроса не поддерживаются. Некорректный UUID возвращает ошибку 400 до обращения к базе данных.",
      request: { params: noteParamsSchema, query: noQuerySchema },
      responses: {
        200: {
          description: "Заметка найдена",
          content: { "application/json": { schema: noteResponseSchema } },
        },
        400: problemResponse(
          "Некорректный JSON, тело запроса, UUID или неожиданные параметры запроса (400)",
        ),
        404: problemResponse("Заметка не найдена (404)"),
        500: problemResponse("Внутренняя ошибка сервера (500)"),
      },
    },
    async (req, res) => {
      const params = noteParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Expected a UUID note identifier.");
      const note = await db.note.findUnique({ where: { id: params.data.id }, select: noteSelect });
      if (!note) throw new ApiError(404, "Note not found.");
      res.json(note);
    },
  );

  module.register(
    {
      method: "delete",
      path: `${basePath}/{id}`,
      operationId: "deleteNote",
      summary: "Удалить заметку",
      description:
        "Параметры запроса не поддерживаются. Некорректный UUID возвращает ошибку 400 до обращения к базе данных. Повторное удаление возвращает 404.",
      request: { params: noteParamsSchema, query: noQuerySchema },
      responses: {
        204: { description: "Заметка удалена; тело ответа пустое" },
        400: problemResponse(
          "Некорректный JSON, тело запроса, UUID или неожиданные параметры запроса (400)",
        ),
        404: problemResponse("Заметка не найдена (404)"),
        500: problemResponse("Внутренняя ошибка сервера (500)"),
      },
    },
    async (req, res) => {
      const params = noteParamsSchema.safeParse(req.params);
      if (!params.success) throw new ApiError(400, "Expected a UUID note identifier.");
      const result = await db.note.deleteMany({ where: { id: params.data.id } });
      if (result.count === 0) throw new ApiError(404, "Note not found.");
      res.status(204).end();
    },
  );

  return module;
}
