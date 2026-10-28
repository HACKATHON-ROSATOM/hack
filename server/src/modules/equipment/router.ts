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
      summary: "List equipment",
      description:
        "Pages start at 1; pageSize defaults to 20 and is limited to 100. Search matches name or external ID without case sensitivity.",
      request: { query: equipmentListQuerySchema },
      responses: {
        200: {
          description: "Equipment page",
          content: { "application/json": { schema: equipmentListSchema } },
        },
        400: problemResponse("Invalid query"),
        500: problemResponse("Internal error"),
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
              { externalId: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};
      const [total, items] = await db.$transaction(
        [
          db.equipment.count({ where }),
          db.equipment.findMany({
            where,
            select: { id: true, externalId: true, name: true, type: true },
            orderBy: [{ externalId: "asc" }, { id: "asc" }],
            skip,
            take: pageSize,
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      res.json({ items, page, pageSize, total });
    },
  );
  api.register(
    {
      method: "get",
      path: "/api/equipment/{id}",
      operationId: "getEquipment",
      summary: "Read equipment and history",
      request: { params: equipmentParamsSchema, query: emptyQuerySchema },
      responses: {
        200: {
          description: "Equipment detail",
          content: { "application/json": { schema: equipmentDetailSchema } },
        },
        400: problemResponse("Invalid identifier or query"),
        404: problemResponse("Equipment not found"),
        500: problemResponse("Internal error"),
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
