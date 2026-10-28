import { z } from "zod";
import type { Database } from "../../database.ts";
import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import type { AuthService } from "../auth/service.ts";

const querySchema = z.strictObject({});
const engineersSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
const usersSchema = z.object({
  items: z.array(
    z.object({ id: z.uuid(), name: z.string(), role: z.enum(["DUTY", "ENGINEER", "DIRECTOR"]) }),
  ),
});

export function createEngineersModule(db: Database, auth: AuthService): ApiModule {
  const api = createApiModule();
  api.register(
    {
      method: "get",
      path: "/api/engineers",
      operationId: "listEngineers",
      summary: "Список инженеров",
      security: [{ bearerAuth: [] }],
      request: { query: querySchema },
      responses: {
        200: {
          description: "Список инженеров",
          content: { "application/json": { schema: engineersSchema } },
        },
        400: problemResponse("Некорректные параметры запроса"),
        401: problemResponse("Требуется авторизация"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      if (!auth.authenticate(req.headers.authorization))
        throw new ApiError(401, "Требуется авторизация.");
      if (!querySchema.safeParse(req.query).success)
        throw new ApiError(400, "Query parameters are not supported.");
      const engineers = await db.user.findMany({
        where: { role: "ENGINEER" },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      });
      res.json({ items: engineers.map(({ id, fullName }) => ({ id, name: fullName })) });
    },
  );
  api.register(
    {
      method: "get",
      path: "/api/users",
      operationId: "listApiUsers",
      summary: "Список пользователей",
      security: [{ bearerAuth: [] }],
      request: { query: querySchema },
      responses: {
        200: {
          description: "Список пользователей",
          content: { "application/json": { schema: usersSchema } },
        },
        400: problemResponse("Некорректные параметры запроса"),
        401: problemResponse("Требуется авторизация"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      if (!auth.authenticate(req.headers.authorization))
        throw new ApiError(401, "Требуется авторизация.");
      if (!querySchema.safeParse(req.query).success)
        throw new ApiError(400, "Query parameters are not supported.");
      const users = await db.user.findMany({
        select: { id: true, fullName: true, role: true },
        orderBy: { fullName: "asc" },
      });
      res.json({ items: users.map(({ id, fullName, role }) => ({ id, name: fullName, role })) });
    },
  );
  return api;
}
