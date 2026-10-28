import { z } from "zod";
import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import type { AuthService } from "../auth/service.ts";
import { isMonitoringIoa, type MonitoringService } from "./service.ts";

const emptyQuery = z.object({}).strict();
const historyQuery = z.object({ ioa: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict();
const signal = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  ioa: z.number(),
  value: z.number().nullable(),
  receivedAt: z.string().nullable(),
  fresh: z.boolean(),
  freshForMs: z.number().nonnegative(),
});
const currentResponse = z.object({
  connected: z.boolean(),
  turbines: z.array(z.object({ id: z.string(), number: z.number(), signals: z.array(signal) })),
});
const historyResponse = z.object({
  items: z.array(z.object({ value: z.number(), receivedAt: z.string() })),
});

export function createMonitoringModule(service: MonitoringService, auth: AuthService): ApiModule {
  const api = createApiModule();
  api.registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });

  api.register(
    {
      method: "get",
      path: "/api/monitoring",
      operationId: "getMonitoring",
      summary: "Текущее состояние телеметрии ВЭУ",
      security: [{ bearerAuth: [] }],
      request: { query: emptyQuery },
      responses: {
        200: {
          description: "Последние наблюдения",
          content: { "application/json": { schema: currentResponse } },
        },
        400: problemResponse("Некорректные параметры запроса"),
        401: problemResponse("Требуется авторизация"),
        403: problemResponse("Недостаточно прав"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      authorize(auth, req.headers.authorization);
      if (!emptyQuery.safeParse(req.query).success)
        throw new ApiError(400, "Invalid monitoring query.");
      res.set("Cache-Control", "no-store").json(await service.getCurrent());
    },
  );

  api.register(
    {
      method: "get",
      path: "/api/monitoring/history",
      operationId: "getMonitoringHistory",
      summary: "История принятых наблюдений",
      security: [{ bearerAuth: [] }],
      request: { query: historyQuery },
      responses: {
        200: {
          description: "Наблюдения сигнала",
          content: { "application/json": { schema: historyResponse } },
        },
        400: problemResponse("Некорректный IOA"),
        401: problemResponse("Требуется авторизация"),
        403: problemResponse("Недостаточно прав"),
        500: problemResponse("Внутренняя ошибка сервера"),
      },
    },
    async (req, res) => {
      authorize(auth, req.headers.authorization);
      const query = historyQuery.safeParse(req.query);
      if (!query.success || !isMonitoringIoa(Number(query.data.ioa))) {
        throw new ApiError(400, "Invalid telemetry IOA.");
      }
      res.set("Cache-Control", "no-store").json(await service.getHistory(Number(query.data.ioa)));
    },
  );
  return api;
}

function authorize(auth: AuthService, authorization: string | undefined): void {
  const user = auth.authenticate(authorization);
  if (!user) throw new ApiError(401, "Invalid session.");
  if (user.role !== "DUTY" && user.role !== "ENGINEER" && user.role !== "DIRECTOR") {
    throw new ApiError(403, "Forbidden.");
  }
}
