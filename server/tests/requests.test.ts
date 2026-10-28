import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import { describe, expect, it, type TestContext } from "vitest";
import { z } from "zod";

import { ApiError, apiErrorHandler } from "../src/http/problem.ts";
import type { AuthService } from "../src/modules/auth/service.ts";
import { RequestsRepository } from "../src/modules/requests/repository.ts";
import { createRequestsModule } from "../src/modules/requests/router.ts";
import {
  ticketDetailResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
  workloadListResponseSchema,
} from "../src/modules/requests/schemas.ts";
import { RequestsService } from "../src/modules/requests/service.ts";

const problemSchema = z.strictObject({
  type: z.literal("about:blank"),
  title: z.string().min(1),
  status: z.number().int(),
  detail: z.string().min(1),
  instance: z.string(),
});

async function expectProblem(response: Response, status: number, instance: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toMatch(/^application\/problem\+json\b/);
  const body: unknown = await response.json();
  const problem = problemSchema.parse(body);
  expect(problem.status).toBe(status);
  expect(problem.instance).toBe(instance);
  return problem;
}

const DEMO_USERS = {
  duty: {
    id: "6e7270af-021d-4c31-9c49-c22d94d17c5b",
    name: "Дежурный",
    role: "DUTY" as const,
  },
  engineer: {
    id: "17f570cb-e70b-418b-b7d0-409e5ee19697",
    name: "Сервисный инженер",
    role: "ENGINEER" as const,
  },
  director: {
    id: "5dbb285c-7deb-4a2a-a961-c24a6860afdc",
    name: "Директор",
    role: "DIRECTOR" as const,
  },
};

const tokens = {
  duty: "duty-session-token-valid-sample-12345678",
  engineer: "engineer-session-token-valid-sample-1234",
  director: "director-session-token-valid-sample-1234",
};

const mockAuth: AuthService = {
  async login() {
    return null;
  },
  authenticate(authorization?: string) {
    if (!authorization) return null;
    const match = /^Bearer (.+)$/i.exec(authorization.trim());
    if (!match?.[1]) return null;
    const token = match[1];
    if (token === tokens.duty) return DEMO_USERS.duty;
    if (token === tokens.engineer) return DEMO_USERS.engineer;
    if (token === tokens.director) return DEMO_USERS.director;
    return null;
  },
};

const dutyHeaders = {
  "content-type": "application/json",
  authorization: `Bearer ${tokens.duty}`,
};

const engineerHeaders = {
  "content-type": "application/json",
  authorization: `Bearer ${tokens.engineer}`,
};

const directorHeaders = {
  "content-type": "application/json",
  authorization: `Bearer ${tokens.director}`,
};

async function serveRequests(t: TestContext) {
  const repo = new RequestsRepository();
  const service = new RequestsService(repo, undefined, mockAuth);
  const requestsModule = createRequestsModule(undefined, mockAuth, service);

  const app = express();
  app.use("/api", express.json({ limit: "16kb" }));
  app.use(requestsModule.router);
  app.use("/api", () => {
    throw new ApiError(404, "API resource not found.");
  });
  app.use("/api", apiErrorHandler);

  const server = app.listen(0, "127.0.0.1");

  t.onTestFinished(async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
    await promise;
  });

  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, repo, service };
}

describe("Requests Module - Authentication & Input Boundaries", () => {
  it("rejects unauthenticated requests without token on create, list, and analytics with 401", async (t) => {
    const { base } = await serveRequests(t);

    const postRes = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "No token",
        initialDeadline: new Date().toISOString(),
      }),
    });
    await expectProblem(postRes, 401, "/api/requests");

    const getRes = await fetch(`${base}/api/requests`);
    await expectProblem(getRes, 401, "/api/requests");

    const overdueRes = await fetch(`${base}/api/requests/analytics/overdue`);
    await expectProblem(overdueRes, 401, "/api/requests/analytics/overdue");

    const workloadRes = await fetch(`${base}/api/requests/analytics/workload`);
    await expectProblem(workloadRes, 401, "/api/requests/analytics/workload");
  });

  it("rejects non-JSON request body with 415", async (t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${tokens.duty}` },
      body: "plain text",
    });
    await expectProblem(response, 415, "/api/requests");
  });

  it.for([
    [
      "missing type",
      { equipmentId: randomUUID(), description: "Test", initialDeadline: new Date().toISOString() },
    ],
    [
      "invalid type",
      {
        type: "UNKNOWN",
        equipmentId: randomUUID(),
        description: "Test",
        initialDeadline: new Date().toISOString(),
      },
    ],
    [
      "invalid equipmentId",
      {
        type: "INSPECTION",
        equipmentId: "not-a-uuid",
        description: "Test",
        initialDeadline: new Date().toISOString(),
      },
    ],
    [
      "empty description",
      {
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "",
        initialDeadline: new Date().toISOString(),
      },
    ],
    [
      "missing initialDeadline",
      { type: "INSPECTION", equipmentId: randomUUID(), description: "Test" },
    ],
    [
      "invalid deadline format",
      {
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Test",
        initialDeadline: "tomorrow",
      },
    ],
    [
      "invalid priority",
      {
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Test",
        initialDeadline: new Date().toISOString(),
        priority: "URGENT",
      },
    ],
    [
      "unknown field",
      {
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Test",
        initialDeadline: new Date().toISOString(),
        unexpectedProperty: true,
      },
    ],
  ] as const)("rejects %s with 400", async ([_name, body], t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify(body),
    });
    await expectProblem(response, 400, "/api/requests");
  });

  it("rejects unexpected query parameters on POST /api/requests", async (t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests?extra=param`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Routine check",
        initialDeadline: new Date().toISOString(),
      }),
    });
    await expectProblem(response, 400, "/api/requests");
  });

  it("rejects malformed UUID in route parameter", async (t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests/not-a-valid-uuid`);
    await expectProblem(response, 400, "/api/requests/not-a-valid-uuid");
  });

  it("returns 404 for non-existent ticket UUID", async (t) => {
    const { base } = await serveRequests(t);
    const nonExistentId = randomUUID();
    const response = await fetch(`${base}/api/requests/${nonExistentId}`, { headers: dutyHeaders });
    await expectProblem(response, 404, `/api/requests/${nonExistentId}`);
  });
});

describe("Requests Module - Role-Based Access Control (RBAC)", () => {
  it("rejects ticket creation for unauthenticated callers (no bearer token)", async (t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Anonymous check",
        initialDeadline: new Date().toISOString(),
      }),
    });
    await expectProblem(response, 401, "/api/requests");
  });

  it("rejects ticket creation when spoofing X-User-Role header without valid token", async (t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-role": "DUTY",
        "x-user-id": DEMO_USERS.duty.id,
      },
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Spoof check",
        initialDeadline: new Date().toISOString(),
      }),
    });
    await expectProblem(response, 401, "/api/requests");
  });

  it("rejects ticket creation for ENGINEER role with 403 Forbidden", async (t) => {
    const { base } = await serveRequests(t);
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Engineer cannot create initial ticket",
        initialDeadline: new Date().toISOString(),
      }),
    });
    await expectProblem(response, 403, "/api/requests");
  });

  it("allows ticket creation for DUTY role", async (t) => {
    const { base } = await serveRequests(t);
    const equipmentId = randomUUID();
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId,
        description: "Плановый осмотр ветрогенератора ВЭУ-01",
        initialDeadline: new Date().toISOString(),
      }),
    });
    expect(response.status).toBe(201);
  });

  it("allows ticket creation for DIRECTOR role", async (t) => {
    const { base } = await serveRequests(t);
    const equipmentId = randomUUID();
    const response = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: directorHeaders,
      body: JSON.stringify({
        type: "REPAIR",
        equipmentId,
        description: "Срочный ремонт лопасти по распоряжению руководства",
        priority: "CRITICAL",
        initialDeadline: new Date().toISOString(),
      }),
    });
    expect(response.status).toBe(201);
  });
});

describe("Requests Module - End-to-End Workflow & State Machine", () => {
  it("executes the full lifecycle: create -> assign -> start -> wait parts -> resume -> complete", async (t) => {
    const { base } = await serveRequests(t);
    const equipmentId = randomUUID();
    const engineerId = DEMO_USERS.engineer.id;

    const createRes = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId,
        description: "Визуальный осмотр гондолы и редуктора",
        priority: "HIGH",
        initialDeadline: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    expect(createRes.status).toBe(201);
    const rawCreated: unknown = await createRes.json();
    const createdTicket = ticketResponseSchema.parse(rawCreated);

    expect(createdTicket.id).toBeDefined();
    expect(createdTicket.type).toBe("INSPECTION");
    expect(createdTicket.status).toBe("NEW");
    expect(createdTicket.source).toBe("MANUAL");
    expect(createdTicket.priority).toBe("HIGH");
    expect(createdTicket.equipmentId).toBe(equipmentId);
    expect(createRes.headers.get("location")).toBe(`/api/requests/${createdTicket.id}`);

    const ticketId = createdTicket.id;

    const readRes = await fetch(`${base}/api/requests/${ticketId}`, { headers: dutyHeaders });
    expect(readRes.status).toBe(200);
    const rawRead: unknown = await readRes.json();
    const readDetails = ticketDetailResponseSchema.parse(rawRead);

    expect(readDetails.id).toBe(ticketId);
    expect(readDetails.auditLogs.length).toBe(1);
    expect(readDetails.auditLogs[0]?.action).toBe("CREATED");

    const assignRes = await fetch(`${base}/api/requests/${ticketId}/assignment`, {
      method: "PATCH",
      headers: dutyHeaders,
      body: JSON.stringify({
        assigneeId: engineerId,
        comment: "Назначен дежурный инженер смены",
      }),
    });

    expect(assignRes.status).toBe(200);
    const assignedTicket = ticketDetailResponseSchema.parse(await assignRes.json());
    expect(assignedTicket.assigneeId).toBe(engineerId);

    const prematureCloseRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "COMPLETED",
        comment: "Закрыто раньше времени",
      }),
    });
    await expectProblem(prematureCloseRes, 400, `/api/requests/${ticketId}/transitions`);

    const startRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Выезд на ветроустановку",
      }),
    });

    expect(startRes.status).toBe(200);
    const startedTicket = ticketDetailResponseSchema.parse(await startRes.json());
    expect(startedTicket.status).toBe("IN_PROGRESS");
    const startLog = startedTicket.auditLogs.find(
      (l) => l.action === "STATUS_CHANGED" && l.newValue === "IN_PROGRESS",
    );
    expect(startLog).toBeDefined();

    const waitRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "WAITING_PARTS",
        comment: "Требуется сальник для гидросистемы",
      }),
    });
    expect(waitRes.status).toBe(200);
    const waitingTicket = ticketDetailResponseSchema.parse(await waitRes.json());
    expect(waitingTicket.status).toBe("WAITING_PARTS");

    const resumeRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Запчасть получена со склада, монтаж",
      }),
    });
    expect(resumeRes.status).toBe(200);
    const resumedTicket = ticketDetailResponseSchema.parse(await resumeRes.json());
    expect(resumedTicket.status).toBe("IN_PROGRESS");

    const noCommentRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "COMPLETED",
        comment: "   ",
      }),
    });
    await expectProblem(noCommentRes, 400, `/api/requests/${ticketId}/transitions`);

    const completionComment = "Сальник заменен, давление в норме, течей нет.";
    const completeRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "COMPLETED",
        comment: completionComment,
      }),
    });

    expect(completeRes.status).toBe(200);
    const completedTicket = ticketDetailResponseSchema.parse(await completeRes.json());
    expect(completedTicket.status).toBe("COMPLETED");
    expect(completedTicket.completedAt).toBeDefined();
    expect(completedTicket.completionComment).toBe(completionComment);

    const finalRes = await fetch(`${base}/api/requests/${ticketId}`, { headers: dutyHeaders });
    const finalTicket = ticketDetailResponseSchema.parse(await finalRes.json());
    const actions = finalTicket.auditLogs.map((log) => log.action);

    expect(actions).toContain("CREATED");
    expect(actions).toContain("ASSIGNED");
    expect(actions).toContain("STATUS_CHANGED");
    expect(finalTicket.auditLogs.length).toBeGreaterThanOrEqual(5);

    const engineerReopenRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Инженер пытается переоткрыть",
      }),
    });
    await expectProblem(engineerReopenRes, 403, `/api/requests/${ticketId}/transitions`);

    const noReasonReopenRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "   ",
      }),
    });
    await expectProblem(noReasonReopenRes, 400, `/api/requests/${ticketId}/transitions`);

    const validReopenRes = await fetch(`${base}/api/requests/${ticketId}/transitions`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        toStatus: "IN_PROGRESS",
        comment: "Ошибочное закрытие, требуется повторный контрольный пуск",
      }),
    });
    expect(validReopenRes.status).toBe(200);
    const reopenedTicket = ticketDetailResponseSchema.parse(await validReopenRes.json());
    expect(reopenedTicket.status).toBe("IN_PROGRESS");
    expect(reopenedTicket.completedAt).toBeNull();
    expect(reopenedTicket.completionComment).toBeNull();
  });

  it("converts an INSPECTION ticket into a REPAIR ticket with reason comment", async (t) => {
    const { base } = await serveRequests(t);
    const equipmentId = randomUUID();

    const createRes = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId,
        description: "Осмотр тормозной системы",
        initialDeadline: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    const ticket = ticketResponseSchema.parse(await createRes.json());
    expect(ticket.type).toBe("INSPECTION");

    const convertReason = "Обнаружен критический износ тормозных колодок, требуется замена";
    const convertRes = await fetch(`${base}/api/requests/${ticket.id}/convert-to-repair`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({ comment: convertReason }),
    });

    expect(convertRes.status).toBe(200);
    const converted = ticketDetailResponseSchema.parse(await convertRes.json());
    expect(converted.type).toBe("REPAIR");

    const conversionLog = converted.auditLogs.find((l) => l.action === "TYPE_CHANGED");
    expect(conversionLog).toBeDefined();
    expect(conversionLog?.oldValue).toBe("INSPECTION");
    expect(conversionLog?.newValue).toBe("REPAIR");
    expect(conversionLog?.comment).toBe(convertReason);

    const invalidConvert = await fetch(`${base}/api/requests/${ticket.id}/convert-to-repair`, {
      method: "POST",
      headers: engineerHeaders,
      body: JSON.stringify({ comment: "Повторная попытка" }),
    });
    await expectProblem(invalidConvert, 400, `/api/requests/${ticket.id}/convert-to-repair`);
  });

  it("supports updating schedule deadline and priority with dual audit logging", async (t) => {
    const { base } = await serveRequests(t);
    const createRes = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "REPAIR",
        equipmentId: randomUUID(),
        description: "Ремонт инвертора",
        priority: "LOW",
        initialDeadline: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    const ticket = ticketResponseSchema.parse(await createRes.json());

    const newDeadline = new Date(Date.now() + 172800000).toISOString();
    const updateRes = await fetch(`${base}/api/requests/${ticket.id}/schedule`, {
      method: "PATCH",
      headers: directorHeaders,
      body: JSON.stringify({
        currentDeadline: newDeadline,
        priority: "CRITICAL",
        comment: "Приоритет повышен в связи с погодными условиями",
      }),
    });

    expect(updateRes.status).toBe(200);
    const updated = ticketDetailResponseSchema.parse(await updateRes.json());
    expect(updated.priority).toBe("CRITICAL");
    expect(updated.currentDeadline).toBe(newDeadline);

    const deadlineLog = updated.auditLogs.find((l) => l.action === "DEADLINE_CHANGED");
    const priorityLog = updated.auditLogs.find((l) => l.action === "PRIORITY_CHANGED");
    expect(deadlineLog).toBeDefined();
    expect(priorityLog).toBeDefined();
    expect(deadlineLog?.newValue).toBe(newDeadline);
    expect(priorityLog?.newValue).toBe("CRITICAL");

    const engineerScheduleRes = await fetch(`${base}/api/requests/${ticket.id}/schedule`, {
      method: "PATCH",
      headers: engineerHeaders,
      body: JSON.stringify({ priority: "LOW" }),
    });
    await expectProblem(engineerScheduleRes, 403, `/api/requests/${ticket.id}/schedule`);
  });

  it("provides analytics for overdue tickets and engineer workload", async (t) => {
    const { base } = await serveRequests(t);
    const engineerA = DEMO_USERS.engineer.id;
    const engineerB = randomUUID();

    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const overdueRes = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "INSPECTION",
        equipmentId: randomUUID(),
        description: "Просроченный осмотр",
        initialDeadline: yesterday,
        assigneeId: engineerA,
      }),
    });
    const overdueTicket = ticketResponseSchema.parse(await overdueRes.json());

    await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "REPAIR",
        equipmentId: randomUUID(),
        description: "Вторая заявка инженера А",
        initialDeadline: new Date(Date.now() + 86400000).toISOString(),
        assigneeId: engineerA,
      }),
    });

    await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: dutyHeaders,
      body: JSON.stringify({
        type: "REPAIR",
        equipmentId: randomUUID(),
        description: "Заявка инженера Б",
        initialDeadline: new Date(Date.now() + 86400000).toISOString(),
        assigneeId: engineerB,
      }),
    });

    const overdueListRes = await fetch(`${base}/api/requests/analytics/overdue`, {
      headers: dutyHeaders,
    });
    expect(overdueListRes.status).toBe(200);
    const overdueList = ticketListResponseSchema.parse(await overdueListRes.json());
    expect(overdueList.items.some((t) => t.id === overdueTicket.id)).toBe(true);

    const workloadRes = await fetch(`${base}/api/requests/analytics/workload`, {
      headers: dutyHeaders,
    });
    expect(workloadRes.status).toBe(200);
    const workload = workloadListResponseSchema.parse(await workloadRes.json());

    const statsA = workload.items.find((w) => w.engineerId === engineerA);
    const statsB = workload.items.find((w) => w.engineerId === engineerB);

    expect(statsA?.activeTicketsCount).toBe(2);
    expect(statsB?.activeTicketsCount).toBe(1);
  });
});
