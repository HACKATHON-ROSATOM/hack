import type { Database } from "../../database.ts";
import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import {
  emptyQuerySchema,
  equipmentDetailSchema,
  equipmentListQuerySchema,
  equipmentListSchema,
  equipmentParamsSchema,
} from "./schemas.ts";

export function createEquipmentModule(db: Database): ApiModule {
  const api = createApiModule();
  api.register(
    {
      method: "get",
      path: "/api/equipment",
      operationId: "listEquipment",
      summary: "Получить список оборудования",
      description:
        "Нумерация страниц начинается с 1; pageSize по умолчанию равен 20 и не может превышать 100. Поиск по названию, внешнему идентификатору или расположению в иерархии не учитывает регистр.",
      request: { query: equipmentListQuerySchema },
      responses: {
        200: {
          description: "Страница списка оборудования",
          content: { "application/json": { schema: equipmentListSchema } },
        },
        400: problemResponse("Некорректные параметры запроса"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      const parsed = equipmentListQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, "Invalid equipment query.");
      const { page = 1, pageSize = 20, search } = parsed.data;
      const skip = (page - 1) * pageSize;
      if (!Number.isSafeInteger(skip) || skip > 2147483647)
        throw new ApiError(400, "Page is too large.");
      const where = search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { externalIdKey: { contains: search, mode: "insensitive" as const } },
              ...Array.from({ length: 7 }, (_, level) => ({
                [`hierarchyLevel${level}`]: { contains: search, mode: "insensitive" as const },
              })),
            ],
          }
        : {};
      const [total, items] = await db.$transaction(
        [
          db.equipment.count({ where }),
          db.equipment.findMany({
            where,
            select: {
              id: true,
              externalId: true,
              name: true,
              type: true,
              hierarchyLevel0: true,
              hierarchyLevel1: true,
              hierarchyLevel2: true,
              hierarchyLevel3: true,
              hierarchyLevel4: true,
              hierarchyLevel5: true,
              hierarchyLevel6: true,
              externalIdKey: true,
            },
            orderBy: [{ externalIdKey: "asc" }, { id: "asc" }],
            skip,
            take: pageSize,
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      res.json({
        items: items.map((item) => ({
          id: item.id,
          externalId: item.externalId,
          name: item.name,
          type: item.type,
          location: [
            item.hierarchyLevel0,
            item.hierarchyLevel1,
            item.hierarchyLevel2,
            item.hierarchyLevel3,
            item.hierarchyLevel4,
            item.hierarchyLevel5,
            item.hierarchyLevel6,
          ]
            .filter((level): level is string => typeof level === "string" && level.length > 0)
            .join(" / "),
        })),
        page,
        pageSize,
        total,
      });
    },
  );
  api.register(
    {
      method: "get",
      path: "/api/equipment/{id}",
      operationId: "getEquipment",
      summary: "Получить оборудование и историю обслуживания",
      request: { params: equipmentParamsSchema, query: emptyQuerySchema },
      responses: {
        200: {
          description: "Карточка оборудования",
          content: { "application/json": { schema: equipmentDetailSchema } },
        },
        400: problemResponse("Некорректный идентификатор или параметры запроса"),
        404: problemResponse("Оборудование не найдено"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      const params = equipmentParamsSchema.safeParse(req.params);
      if (!params.success || !emptyQuerySchema.safeParse(req.query).success)
        throw new ApiError(400, "Invalid equipment identifier or query.");
      const equipment = await db.equipment.findUnique({
        where: { id: params.data.id },
        include: {
          history: {
            orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }, { importRowId: "asc" }],
          },
        },
      });
      if (!equipment) throw new ApiError(404, "Equipment not found.");
      res.json(equipment);
    },
  );
  return api;
}
