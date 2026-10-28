import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";
import { z } from "zod";

import { environmentSchema } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { ApiError, apiErrorHandler } from "../src/http/problem.ts";
import { PREDEFINED_USERS } from "../src/modules/requests/auth.ts";
import { createRequestsModule } from "../src/modules/requests/router.ts";
import {
  loginResponseSchema,
  ticketDetailResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
  workloadListResponseSchema,
} from "../src/modules/requests/schemas.ts";

const problemSchema = z.strictObject({
  type: z.literal("about:blank"),
  title: z.string().min(1),
  status: z.number().int(),
  detail: z.string().min(1),
  instance: z.string(),
});

async function expectProblem(response: Response, status: number, path: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type") ?? "", /^application\/problem\+json\b/);
  const data: unknown = await response.json();
  const problem = problemSchema.parse(data);
  assert.equal(problem.status, status);
  assert.equal(problem.instance, path);
}

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const envResult = environmentSchema.pick({ DATABASE_URL: true }).safeParse(process.env);
if (!envResult.success) {
  throw new Error("Не задан корректный DATABASE_URL");
}

function buildApp(db: Database) {
  const app = express();
  app.use("/api", express.json({ limit: "16kb" }));
  const requestsModule = createRequestsModule(db);
  app.use(requestsModule.router);
  app.use("/api", () => {
    throw new ApiError(404, "API resource not found.");
  });
  app.use("/api", apiErrorHandler);
  return app;
}

async function startServer(db: Database): Promise<{ server: Server; base: string }> {
  const app = buildApp(db);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Не удалось получить адрес сервера");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

let db = createDatabase(envResult.data.DATABASE_URL);
let currentServer: Server | null = null;
let createdTicketId: string | null = null;
let failed = false;

try {
  const { server, base } = await startServer(db);
  currentServer = server;

  console.log(`[Smoke] Test server running at ${base}`);

  console.log("[Smoke] 1. Проверка авторизации трёх пользователей через /api/auth/login...");
  const dutyLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "duty", password: "duty123" }),
  });
  assert.equal(dutyLoginRes.status, 200);
  const dutyAuth = loginResponseSchema.parse(await dutyLoginRes.json());
  assert.equal(dutyAuth.user.role, "DUTY");
  const dutyHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${dutyAuth.token}`,
  };

  const engineerLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "engineer", password: "engineer123" }),
  });
  assert.equal(engineerLoginRes.status, 200);
  const engineerAuth = loginResponseSchema.parse(await engineerLoginRes.json());
  assert.equal(engineerAuth.user.role, "ENGINEER");
  const engineerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${engineerAuth.token}`,
  };

  const directorLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "director", password: "director123" }),
  });
  assert.equal(directorLoginRes.status, 200);
  const directorAuth = loginResponseSchema.parse(await directorLoginRes.json());
  assert.equal(directorAuth.user.role, "DIRECTOR");
  const directorHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${directorAuth.token}`,
  };

  const invalidLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "duty", password: "wrong-password" }),
  });
  await expectProblem(invalidLoginRes, 400, "/api/auth/login");

  console.log("[Smoke] 2. Проверка RBAC и отказ произвольным заголовкам без токена...");
  const spoofRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": "DUTY",
      "x-user-id": PREDEFINED_USERS.duty.id,
    },
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: randomUUID(),
      description: "Попытка подделки заголовка",
      initialDeadline: new Date().toISOString(),
    }),
  });
  await expectProblem(spoofRes, 401, "/api/requests");

  const engineerCreateRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: randomUUID(),
      description: "Инженер пытается создать заявку напрямую",
      initialDeadline: new Date().toISOString(),
    }),
  });
  await expectProblem(engineerCreateRes, 403, "/api/requests");

  console.log("[Smoke] 3. Проверка срока и оборудования из реального реестра...");
  const realEquipment = await db.equipment.findFirst();
  assert.ok(realEquipment, "В базе данных отсутствует импортированное оборудование");

  const missingDeadlineToRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: realEquipment.id,
      description: "Заявка без обязательного срока",
    }),
  });
  await expectProblem(missingDeadlineToRes, 400, "/api/requests");

  const nonExistentEquipmentRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: randomUUID(),
      description: "Заявка с несуществующим оборудованием",
      initialDeadline: new Date(Date.now() + 86400000).toISOString(),
    }),
  });
  await expectProblem(nonExistentEquipmentRes, 400, "/api/requests");

  console.log("[Smoke] 4. Дежурный создаёт заявку на реальный объект со сроком и назначением...");
  const initialDeadline = new Date(Date.now() + 86400000).toISOString();
  const createRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: realEquipment.id,
      description: `Плановый осмотр оборудования ${realEquipment.name}`,
      priority: "HIGH",
      initialDeadline,
      assigneeId: PREDEFINED_USERS.engineer.id,
    }),
  });
  assert.equal(createRes.status, 201);
  const createdTicket = ticketResponseSchema.parse(await createRes.json());
  createdTicketId = createdTicket.id;
  assert.equal(createRes.headers.get("location"), `/api/requests/${createdTicketId}`);
  assert.equal(createdTicket.status, "NEW");
  assert.equal(createdTicket.equipmentId, realEquipment.id);
  assert.equal(createdTicket.authorId, PREDEFINED_USERS.duty.id);
  assert.equal(createdTicket.assigneeId, PREDEFINED_USERS.engineer.id);

  const initialDetailRes = await fetch(`${base}/api/requests/${createdTicketId}`);
  const initialDetail = ticketDetailResponseSchema.parse(await initialDetailRes.json());
  assert.equal(initialDetail.auditLogs.length, 2);
  assert.equal(initialDetail.auditLogs[0]?.action, "CREATED");
  assert.equal(initialDetail.auditLogs[1]?.action, "ASSIGNED");

  console.log(
    "[Smoke] 5. Одновременное изменение срока и приоритета фиксирует оба изменения в журнале...",
  );
  const newDeadline = new Date(Date.now() + 172800000).toISOString();
  const scheduleUpdateRes = await fetch(`${base}/api/requests/${createdTicketId}/schedule`, {
    method: "PATCH",
    headers: directorHeaders,
    body: JSON.stringify({
      currentDeadline: newDeadline,
      priority: "CRITICAL",
      comment: "Корректировка плана директором",
    }),
  });
  assert.equal(scheduleUpdateRes.status, 200);
  const scheduleUpdatedTicket = ticketDetailResponseSchema.parse(await scheduleUpdateRes.json());
  assert.equal(scheduleUpdatedTicket.priority, "CRITICAL");
  assert.equal(scheduleUpdatedTicket.currentDeadline, newDeadline);

  const deadlineEntry = scheduleUpdatedTicket.auditLogs.find(
    (l) => l.action === "DEADLINE_CHANGED",
  );
  const priorityEntry = scheduleUpdatedTicket.auditLogs.find(
    (l) => l.action === "PRIORITY_CHANGED",
  );
  assert.ok(deadlineEntry, "Отсутствует запись DEADLINE_CHANGED в журнале");
  assert.ok(priorityEntry, "Отсутствует запись PRIORITY_CHANGED в журнале");
  assert.equal(deadlineEntry.newValue, newDeadline);
  assert.equal(priorityEntry.newValue, "CRITICAL");

  console.log("[Smoke] 6. Инженер начинает работу, переходит в ожидание ЗИП и обратно...");
  const startRes = await fetch(`${base}/api/requests/${createdTicketId}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "Инженер прибыл на объект, начало осмотра",
    }),
  });
  assert.equal(startRes.status, 200);

  const waitPartsRes = await fetch(`${base}/api/requests/${createdTicketId}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "WAITING_PARTS",
      comment: "Требуется сальник и масло, переход в ожидание ЗИП",
    }),
  });
  assert.equal(waitPartsRes.status, 200);
  const waitingTicket = ticketDetailResponseSchema.parse(await waitPartsRes.json());
  assert.equal(waitingTicket.status, "WAITING_PARTS");

  const resumeRes = await fetch(`${base}/api/requests/${createdTicketId}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "ЗИП получен, возобновление работы",
    }),
  });
  assert.equal(resumeRes.status, 200);
  const resumedTicket = ticketDetailResponseSchema.parse(await resumeRes.json());
  assert.equal(resumedTicket.status, "IN_PROGRESS");

  console.log("[Smoke] 7. Закрытие без комментария отклоняется, с комментарием принимается...");
  const emptyCommentCloseRes = await fetch(`${base}/api/requests/${createdTicketId}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: "    ",
    }),
  });
  await expectProblem(emptyCommentCloseRes, 400, `/api/requests/${createdTicketId}/transitions`);

  const closeComment = "ремонт не потребовался";
  const validCloseRes = await fetch(`${base}/api/requests/${createdTicketId}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: closeComment,
    }),
  });
  assert.equal(validCloseRes.status, 200);
  const closedTicket = ticketDetailResponseSchema.parse(await validCloseRes.json());
  assert.equal(closedTicket.status, "COMPLETED");
  assert.equal(closedTicket.completionComment, closeComment);

  console.log(
    "[Smoke] 8. Проверка списка, просрочки и нагрузки по сохранённым данным PostgreSQL...",
  );
  const listRes = await fetch(`${base}/api/requests`);
  assert.equal(listRes.status, 200);
  const listData = ticketListResponseSchema.parse(await listRes.json());
  assert.ok(listData.items.some((item) => item.id === createdTicketId));

  const overdueRes = await fetch(`${base}/api/requests/analytics/overdue`);
  assert.equal(overdueRes.status, 200);

  const workloadRes = await fetch(`${base}/api/requests/analytics/workload`);
  assert.equal(workloadRes.status, 200);
  workloadListResponseSchema.parse(await workloadRes.json());

  console.log("[Smoke] 9. Проверка сохранения заявки и журнала после перезапуска приложения...");
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.$disconnect();

  const restartedDb = createDatabase(envResult.data.DATABASE_URL);
  db = restartedDb;
  const restarted = await startServer(restartedDb);
  currentServer = restarted.server;

  const afterRestartRes = await fetch(`${restarted.base}/api/requests/${createdTicketId}`);
  assert.equal(afterRestartRes.status, 200);
  const afterRestartTicket = ticketDetailResponseSchema.parse(await afterRestartRes.json());
  assert.equal(afterRestartTicket.id, createdTicketId);
  assert.equal(afterRestartTicket.status, "COMPLETED");
  assert.equal(afterRestartTicket.priority, "CRITICAL");
  assert.equal(afterRestartTicket.completionComment, closeComment);
  assert.ok(afterRestartTicket.auditLogs.length >= 6);

  console.log(
    "Сквозная проверка заявок, PostgreSQL, RBAC, журнала и перезапуска успешно пройдена!",
  );
} catch (error) {
  failed = true;
  console.error("Requests HTTP smoke failed:", error);
} finally {
  if (currentServer) {
    try {
      currentServer.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        currentServer!.close((err) => (err ? reject(err) : resolve())),
      );
    } catch {}
  }
  if (db) {
    if (createdTicketId) {
      try {
        await db.$executeRawUnsafe(`DELETE FROM "Ticket" WHERE "id" = $1;`, createdTicketId);
      } catch {}
    }
    await db.$disconnect();
  }
}

if (failed) {
  process.exitCode = 1;
}
