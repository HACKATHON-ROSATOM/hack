import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { z } from "zod";

import { createApp } from "../src/app.ts";
import { environmentSchema } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { createAuthService, hashPassword, type AuthService } from "../src/modules/auth/service.ts";
import {
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

async function startServer(
  db: Database,
  auth: AuthService,
): Promise<{ server: Server; base: string }> {
  const app = createApp(db, auth);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Не удалось получить адрес сервера");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

let db = createDatabase(envResult.data.DATABASE_URL);
let auth = createAuthService(db);
let currentServer: Server | null = null;
const createdTicketIds: string[] = [];
const secondEngineerId = randomUUID();
let failed = false;

try {
  await db.user.deleteMany({ where: { login: "engineer2_smoke" } });
  await db.user.create({
    data: {
      id: secondEngineerId,
      login: "engineer2_smoke",
      passwordHash: await hashPassword("demo-engineer-2026"),
      fullName: "Второй сервисный инженер",
      role: "ENGINEER",
    },
  });

  const { server, base } = await startServer(db, auth);
  currentServer = server;

  console.log(`[Smoke] Test server running at ${base}`);

  console.log("[Smoke] 1. Проверка авторизации пользователей через общий /api/auth/login...");
  const dutyLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "duty", password: "demo-duty-2026" }),
  });
  assert.equal(dutyLoginRes.status, 200);
  const dutyAuth = (await dutyLoginRes.json()) as {
    token: string;
    user: { id: string; role: string };
  };
  assert.equal(dutyAuth.user.role, "DUTY");
  const dutyHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${dutyAuth.token}`,
  };

  const engineerLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "engineer", password: "demo-engineer-2026" }),
  });
  assert.equal(engineerLoginRes.status, 200);
  const engineerAuth = (await engineerLoginRes.json()) as {
    token: string;
    user: { id: string; role: string };
  };
  assert.equal(engineerAuth.user.role, "ENGINEER");
  const engineerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${engineerAuth.token}`,
  };

  const engineer2LoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "engineer2_smoke", password: "demo-engineer-2026" }),
  });
  assert.equal(engineer2LoginRes.status, 200);
  const engineer2Auth = (await engineer2LoginRes.json()) as {
    token: string;
    user: { id: string; role: string };
  };
  assert.equal(engineer2Auth.user.role, "ENGINEER");
  const engineer2Headers = {
    "content-type": "application/json",
    authorization: `Bearer ${engineer2Auth.token}`,
  };

  const directorLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "director", password: "demo-director-2026" }),
  });
  assert.equal(directorLoginRes.status, 200);
  const directorAuth = (await directorLoginRes.json()) as {
    token: string;
    user: { id: string; role: string };
  };
  assert.equal(directorAuth.user.role, "DIRECTOR");
  const directorHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${directorAuth.token}`,
  };

  const invalidLoginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "duty", password: "wrong-password" }),
  });
  assert.equal(invalidLoginRes.status, 401);

  console.log("[Smoke] 2. Проверка защиты всех эндпоинтов от неавторизованных запросов и RBAC...");
  const anonPostRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: randomUUID(),
      description: "Анонимный запрос",
      initialDeadline: new Date().toISOString(),
    }),
  });
  await expectProblem(anonPostRes, 401, "/api/requests");

  const anonGetRes = await fetch(`${base}/api/requests`);
  await expectProblem(anonGetRes, 401, "/api/requests");

  const spoofRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": "DUTY",
      "x-user-id": dutyAuth.user.id,
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

  console.log(
    "[Smoke] 4. Проверка валидации назначаемого инженера и запрета переходов без исполнителя...",
  );
  const directorAssigneeRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: realEquipment.id,
      description: "Попытка назначить директора при создании",
      initialDeadline: new Date(Date.now() + 86400000).toISOString(),
      assigneeId: directorAuth.user.id,
    }),
  });
  await expectProblem(directorAssigneeRes, 400, "/api/requests");

  const nonExistentAssigneeRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: realEquipment.id,
      description: "Попытка назначить несуществующего пользователя при создании",
      initialDeadline: new Date(Date.now() + 86400000).toISOString(),
      assigneeId: randomUUID(),
    }),
  });
  await expectProblem(nonExistentAssigneeRes, 400, "/api/requests");

  const unassignedCreateRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: realEquipment.id,
      description: `Плановый осмотр оборудования ${realEquipment.name} без первоначального назначения`,
      priority: "HIGH",
      initialDeadline: new Date(Date.now() + 86400000).toISOString(),
    }),
  });
  assert.equal(unassignedCreateRes.status, 201);
  const unassignedTicket = ticketResponseSchema.parse(await unassignedCreateRes.json());
  createdTicketIds.push(unassignedTicket.id);
  assert.equal(unassignedTicket.assigneeId, null);

  const startUnassignedRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/transitions`,
    {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Инженер пытается начать работу по заявке без исполнителя",
      }),
    },
  );
  await expectProblem(startUnassignedRes, 400, `/api/requests/${unassignedTicket.id}/transitions`);

  const convertUnassignedRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/convert-to-repair`,
    {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        comment: "Попытка перевода в ремонт без исполнителя",
      }),
    },
  );
  await expectProblem(
    convertUnassignedRes,
    400,
    `/api/requests/${unassignedTicket.id}/convert-to-repair`,
  );

  const reassignDirectorRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/assignment`,
    {
      method: "PATCH",
      headers: dutyHeaders,
      body: JSON.stringify({ assigneeId: directorAuth.user.id }),
    },
  );
  await expectProblem(reassignDirectorRes, 400, `/api/requests/${unassignedTicket.id}/assignment`);

  const reassignNotFoundRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/assignment`,
    {
      method: "PATCH",
      headers: dutyHeaders,
      body: JSON.stringify({ assigneeId: randomUUID() }),
    },
  );
  await expectProblem(reassignNotFoundRes, 400, `/api/requests/${unassignedTicket.id}/assignment`);

  const assignValidRes = await fetch(`${base}/api/requests/${unassignedTicket.id}/assignment`, {
    method: "PATCH",
    headers: dutyHeaders,
    body: JSON.stringify({
      assigneeId: engineerAuth.user.id,
      comment: "Назначен дежурный сервисный инженер",
    }),
  });
  assert.equal(assignValidRes.status, 200);
  const assignedTicket = ticketDetailResponseSchema.parse(await assignValidRes.json());
  assert.equal(assignedTicket.assigneeId, engineerAuth.user.id);
  assert.equal(
    assignedTicket.auditLogs.some((l) => l.action === "ASSIGNED"),
    true,
  );

  console.log(
    "[Smoke] 4.1. Проверка 12 одновременных запросов перехода NEW -> IN_PROGRESS на PostgreSQL...",
  );
  const concurrentResponses = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      fetch(`${base}/api/requests/${unassignedTicket.id}/transitions`, {
        method: "POST",
        headers: engineerHeaders,
        body: JSON.stringify({
          toStatus: "IN_PROGRESS",
          comment: `Одновременная попытка начала #${i + 1}`,
        }),
      }),
    ),
  );
  const success200 = concurrentResponses.filter((r) => r.status === 200);
  const rejected400 = concurrentResponses.filter((r) => r.status === 400);
  assert.equal(
    success200.length,
    1,
    `Ровно один одновременный запрос должен получить 200 (получено: ${success200.length})`,
  );
  assert.equal(
    rejected400.length,
    11,
    `Остальные 11 одновременных запросов должны получить 400 (получено: ${rejected400.length})`,
  );

  const detailAfterConcurrent = ticketDetailResponseSchema.parse(
    await (
      await fetch(`${base}/api/requests/${unassignedTicket.id}`, { headers: dutyHeaders })
    ).json(),
  );
  assert.equal(detailAfterConcurrent.status, "IN_PROGRESS");
  const inProgressAuditLogs = detailAfterConcurrent.auditLogs.filter(
    (l) => l.action === "STATUS_CHANGED" && l.newValue === "IN_PROGRESS",
  );
  assert.equal(
    inProgressAuditLogs.length,
    1,
    `В журнале должна остаться ровно 1 запись перехода в IN_PROGRESS (получено: ${inProgressAuditLogs.length})`,
  );

  const otherEngineerStartRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/transitions`,
    {
      method: "POST",
      headers: engineer2Headers,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Неназначенный инженер пытается начать чужую заявку",
      }),
    },
  );
  await expectProblem(
    otherEngineerStartRes,
    403,
    `/api/requests/${unassignedTicket.id}/transitions`,
  );

  const otherEngineerConvertRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/convert-to-repair`,
    {
      method: "POST",
      headers: engineer2Headers,
      body: JSON.stringify({
        comment: "Неназначенный инженер пытается перевести в ремонт",
      }),
    },
  );
  await expectProblem(
    otherEngineerConvertRes,
    403,
    `/api/requests/${unassignedTicket.id}/convert-to-repair`,
  );

  console.log(
    "[Smoke] 5. Изменение плана директором, конкурентное переназначение и завершение заявки...",
  );
  const newDeadline = new Date(Date.now() + 172800000).toISOString();
  const scheduleUpdateRes = await fetch(`${base}/api/requests/${unassignedTicket.id}/schedule`, {
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

  const [reassignRes, oldEngineerWaitRes] = await Promise.all([
    fetch(`${base}/api/requests/${unassignedTicket.id}/assignment`, {
      method: "PATCH",
      headers: dutyHeaders,
      body: JSON.stringify({
        assigneeId: secondEngineerId,
        comment: "Срочная передача второму инженеру",
      }),
    }),
    fetch(`${base}/api/requests/${unassignedTicket.id}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "WAITING_PARTS",
        comment: "Прежний инженер пытается сменить статус",
      }),
    }),
  ]);
  assert.equal(reassignRes.status, 200);
  assert.ok([200, 403].includes(oldEngineerWaitRes.status));

  const postReassignOldEngineerRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/transitions`,
    {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "COMPLETED",
        comment: "Прежний инженер пытается завершить чужую заявку",
      }),
    },
  );
  await expectProblem(
    postReassignOldEngineerRes,
    403,
    `/api/requests/${unassignedTicket.id}/transitions`,
  );

  const currentDetail = ticketDetailResponseSchema.parse(
    await (
      await fetch(`${base}/api/requests/${unassignedTicket.id}`, { headers: dutyHeaders })
    ).json(),
  );
  if (currentDetail.status === "WAITING_PARTS") {
    const resumeRes = await fetch(`${base}/api/requests/${unassignedTicket.id}/transitions`, {
      method: "POST",
      headers: engineer2Headers,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Второй инженер возобновляет работу",
      }),
    });
    assert.equal(resumeRes.status, 200);
  }

  const emptyCommentCloseRes = await fetch(
    `${base}/api/requests/${unassignedTicket.id}/transitions`,
    {
      method: "POST",
      headers: engineer2Headers,
      body: JSON.stringify({
        toStatus: "COMPLETED",
        comment: "    ",
      }),
    },
  );
  await expectProblem(
    emptyCommentCloseRes,
    400,
    `/api/requests/${unassignedTicket.id}/transitions`,
  );

  const inspectionCloseComment = "Осмотр завершен успешно назначенным вторым инженером";
  const validCloseRes = await fetch(`${base}/api/requests/${unassignedTicket.id}/transitions`, {
    method: "POST",
    headers: engineer2Headers,
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: inspectionCloseComment,
    }),
  });
  assert.equal(validCloseRes.status, 200);
  const closedInspection = ticketDetailResponseSchema.parse(await validCloseRes.json());
  assert.equal(closedInspection.status, "COMPLETED");
  assert.equal(closedInspection.completionComment, inspectionCloseComment);

  console.log(
    "[Smoke] 6. Сквозной сценарий заявки REPAIR: работа -> ожидание ЗИП -> работа -> закрытие...",
  );
  const repairCreateRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "REPAIR",
      equipmentId: realEquipment.id,
      description: `Капитальный ремонт узла агрегата ${realEquipment.name}`,
      priority: "HIGH",
      initialDeadline: new Date(Date.now() + 86400000).toISOString(),
      assigneeId: secondEngineerId,
    }),
  });
  assert.equal(repairCreateRes.status, 201);
  const repairTicket = ticketResponseSchema.parse(await repairCreateRes.json());
  createdTicketIds.push(repairTicket.id);
  assert.equal(repairTicket.type, "REPAIR");
  assert.equal(repairTicket.status, "NEW");
  assert.equal(repairTicket.assigneeId, secondEngineerId);

  const eng1WrongStartRepair = await fetch(`${base}/api/requests/${repairTicket.id}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "Попытка чужого инженера начать ремонт",
    }),
  });
  await expectProblem(eng1WrongStartRepair, 403, `/api/requests/${repairTicket.id}/transitions`);

  const repairStartRes = await fetch(`${base}/api/requests/${repairTicket.id}/transitions`, {
    method: "POST",
    headers: engineer2Headers,
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "Начало демонтажа подшипникового щита",
    }),
  });
  assert.equal(repairStartRes.status, 200);
  const repairStarted = ticketDetailResponseSchema.parse(await repairStartRes.json());
  assert.equal(repairStarted.status, "IN_PROGRESS");

  const repairWaitPartsRes = await fetch(`${base}/api/requests/${repairTicket.id}/transitions`, {
    method: "POST",
    headers: engineer2Headers,
    body: JSON.stringify({
      toStatus: "WAITING_PARTS",
      comment: "Ожидание поставки оригинального подшипника SKF",
    }),
  });
  assert.equal(repairWaitPartsRes.status, 200);
  const repairWaiting = ticketDetailResponseSchema.parse(await repairWaitPartsRes.json());
  assert.equal(repairWaiting.status, "WAITING_PARTS");

  const repairResumeRes = await fetch(`${base}/api/requests/${repairTicket.id}/transitions`, {
    method: "POST",
    headers: engineer2Headers,
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "Подшипник со склада получен, монтаж и центровка",
    }),
  });
  assert.equal(repairResumeRes.status, 200);
  const repairResumed = ticketDetailResponseSchema.parse(await repairResumeRes.json());
  assert.equal(repairResumed.status, "IN_PROGRESS");

  const repairCloseComment = "Ремонт завершён успешно, заменён подшипник, вибрация в пределах ГОСТ";
  const repairCompleteRes = await fetch(`${base}/api/requests/${repairTicket.id}/transitions`, {
    method: "POST",
    headers: engineer2Headers,
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: repairCloseComment,
    }),
  });
  assert.equal(repairCompleteRes.status, 200);
  const repairCompleted = ticketDetailResponseSchema.parse(await repairCompleteRes.json());
  assert.equal(repairCompleted.status, "COMPLETED");
  assert.equal(repairCompleted.type, "REPAIR");
  assert.equal(repairCompleted.completionComment, repairCloseComment);
  assert.ok(repairCompleted.completedAt);

  console.log("[Smoke] 7. Контролируемая проверка просрочки и нагрузки с точными числами...");
  const baselineWorkloadRes = await fetch(`${base}/api/requests/analytics/workload`, {
    headers: dutyHeaders,
  });
  assert.equal(baselineWorkloadRes.status, 200);
  const baselineWorkload = workloadListResponseSchema.parse(await baselineWorkloadRes.json());
  const baselineEng1 =
    baselineWorkload.items.find((w) => w.engineerId === engineerAuth.user.id)?.activeTicketsCount ??
    0;
  const baselineEng2 =
    baselineWorkload.items.find((w) => w.engineerId === secondEngineerId)?.activeTicketsCount ?? 0;

  const pastDeadline = new Date(Date.now() - 3600000).toISOString();
  const overdueCreateRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: dutyHeaders,
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId: realEquipment.id,
      description: "Контрольная просроченная заявка",
      priority: "CRITICAL",
      initialDeadline: pastDeadline,
      assigneeId: engineerAuth.user.id,
    }),
  });
  assert.equal(overdueCreateRes.status, 201);
  const overdueTicket = ticketResponseSchema.parse(await overdueCreateRes.json());
  createdTicketIds.push(overdueTicket.id);

  const overdueAnalyticsRes = await fetch(`${base}/api/requests/analytics/overdue`, {
    headers: dutyHeaders,
  });
  assert.equal(overdueAnalyticsRes.status, 200);
  const overdueAnalytics = ticketListResponseSchema.parse(await overdueAnalyticsRes.json());
  const foundOverdueTicket = overdueAnalytics.items.find((t) => t.id === overdueTicket.id);
  assert.ok(
    foundOverdueTicket,
    "Просроченная незавершённая заявка должна быть в списке просроченных",
  );
  assert.equal(foundOverdueTicket.isOverdue, true);
  assert.equal(foundOverdueTicket.assigneeId, engineerAuth.user.id);

  const workloadAfterCreateRes = await fetch(`${base}/api/requests/analytics/workload`, {
    headers: dutyHeaders,
  });
  assert.equal(workloadAfterCreateRes.status, 200);
  const workloadAfterCreate = workloadListResponseSchema.parse(await workloadAfterCreateRes.json());
  const eng1CountAfterCreate =
    workloadAfterCreate.items.find((w) => w.engineerId === engineerAuth.user.id)
      ?.activeTicketsCount ?? 0;
  const eng2CountAfterCreate =
    workloadAfterCreate.items.find((w) => w.engineerId === secondEngineerId)?.activeTicketsCount ??
    0;

  assert.equal(
    eng1CountAfterCreate,
    baselineEng1 + 1,
    `Нагрузка инженера 1 должна вырасти ровно на 1 (ожидалось ${baselineEng1 + 1}, получено ${eng1CountAfterCreate})`,
  );
  assert.equal(
    eng2CountAfterCreate,
    baselineEng2,
    `Нагрузка инженера 2 не должна измениться (ожидалось ${baselineEng2}, получено ${eng2CountAfterCreate})`,
  );

  const startOverdueRes = await fetch(`${base}/api/requests/${overdueTicket.id}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "Срочный выезд по просроченной заявке",
    }),
  });
  assert.equal(startOverdueRes.status, 200);

  const closeOverdueRes = await fetch(`${base}/api/requests/${overdueTicket.id}/transitions`, {
    method: "POST",
    headers: engineerHeaders,
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: "Просроченный осмотр завершен в оперативном порядке",
    }),
  });
  assert.equal(closeOverdueRes.status, 200);

  const overdueAnalyticsAfterCloseRes = await fetch(`${base}/api/requests/analytics/overdue`, {
    headers: dutyHeaders,
  });
  const overdueAnalyticsAfterClose = ticketListResponseSchema.parse(
    await overdueAnalyticsAfterCloseRes.json(),
  );
  assert.equal(
    overdueAnalyticsAfterClose.items.some((t) => t.id === overdueTicket.id),
    false,
    "Завершённая заявка не должна попадать в аналитику просроченных",
  );

  const workloadFinalRes = await fetch(`${base}/api/requests/analytics/workload`, {
    headers: dutyHeaders,
  });
  const workloadFinal = workloadListResponseSchema.parse(await workloadFinalRes.json());
  const eng1CountFinal =
    workloadFinal.items.find((w) => w.engineerId === engineerAuth.user.id)?.activeTicketsCount ?? 0;
  assert.equal(
    eng1CountFinal,
    baselineEng1,
    `После завершения всех заявок нагрузка инженера 1 вернулась к ${baselineEng1}`,
  );

  console.log("[Smoke] 8. Проверка сохранения заявки и журнала после перезапуска приложения...");
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.$disconnect();

  const restartedDb = createDatabase(envResult.data.DATABASE_URL);
  const restartedAuth = createAuthService(restartedDb);
  db = restartedDb;
  auth = restartedAuth;
  const restarted = await startServer(restartedDb, restartedAuth);
  currentServer = restarted.server;

  const afterRestartLoginRes = await fetch(`${restarted.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "duty", password: "demo-duty-2026" }),
  });
  assert.equal(afterRestartLoginRes.status, 200);
  const afterRestartAuth = (await afterRestartLoginRes.json()) as { token: string };

  const afterRestartRes = await fetch(`${restarted.base}/api/requests/${unassignedTicket.id}`, {
    headers: { authorization: `Bearer ${afterRestartAuth.token}` },
  });
  assert.equal(afterRestartRes.status, 200);
  const afterRestartTicket = ticketDetailResponseSchema.parse(await afterRestartRes.json());
  assert.equal(afterRestartTicket.id, unassignedTicket.id);
  assert.equal(afterRestartTicket.status, "COMPLETED");
  assert.equal(afterRestartTicket.priority, "CRITICAL");
  assert.equal(afterRestartTicket.completionComment, inspectionCloseComment);
  assert.ok(afterRestartTicket.auditLogs.length >= 6);

  console.log(
    "Сквозная проверка валидации инженеров, ремонта, точной аналитики и персистентности успешно пройдена!",
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
    for (const id of createdTicketIds) {
      try {
        await db.ticketAuditLog.deleteMany({ where: { ticketId: id } });
        await db.ticket.delete({ where: { id } });
      } catch {}
    }
    try {
      await db.user.deleteMany({ where: { login: "engineer2_smoke" } });
    } catch {}
    await db.$disconnect();
  }
}

if (failed) {
  process.exitCode = 1;
}
