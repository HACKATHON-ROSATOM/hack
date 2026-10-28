import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import type { AuthService } from "./service.ts";
import { loginQuerySchema, loginResponseSchema, loginSchema } from "./schemas.ts";

export function createAuthModule(auth: AuthService): ApiModule {
  const api = createApiModule();
  api.register(
    {
      method: "post",
      path: "/api/auth/login",
      operationId: "login",
      summary: "Войти в систему",
      description: "Параметры запроса не поддерживаются.",
      request: {
        query: loginQuerySchema,
        body: { required: true, content: { "application/json": { schema: loginSchema } } },
      },
      responses: {
        200: {
          description: "Вход выполнен",
          content: { "application/json": { schema: loginResponseSchema } },
        },
        400: problemResponse("Некорректные входные данные"),
        401: problemResponse("Неверный логин или пароль"),
        415: problemResponse("Ожидается JSON"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      if (!loginQuerySchema.safeParse(req.query).success)
        throw new ApiError(400, "Query parameters are not supported.");
      if (!req.is("application/json")) throw new ApiError(415, "Expected application/json.");
      const body = loginSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, "Invalid login input.");
      const result = await auth.login(body.data.login, body.data.password);
      if (!result) throw new ApiError(401, "Invalid credentials.");
      res.set("Cache-Control", "no-store").json(result);
    },
  );
  return api;
}
