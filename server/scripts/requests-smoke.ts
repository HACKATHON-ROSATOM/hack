import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import { z } from "zod";

import { environmentSchema } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { ApiError, apiErrorHandler } from "../src/http/problem.ts";
import { createRequestsModule } from "../src/modules/requests/router.ts";
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
const db: Database | undefined = envResult.success
  ? createDatabase(envResult.data.DATABASE_URL)
  : undefined;

const app = express();
app.use("/api", express.json({ limit: "16kb" }));
const requestsModule = createRequestsModule(db);
app.use(requestsModule.router);
app.use("/api", () => {
  throw new ApiError(404, "API resource not found.");
});
app.use("/api", apiErrorHandler);

const server = createServer(app);

const equipmentId = randomUUID();
const engineerId = randomUUID();
const dutyId = randomUUID();
const testMarker = `Requests smoke ${randomUUID()}`;

let failed = false;

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing loopback address");
  const base = `http://127.0.0.1:${address.port}`;

  console.log(`[Smoke] Test server listening at ${base}`);

  console.log("[Smoke] Step 1: Creating ticket by DUTY role...");
  const createRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": "DUTY",
      "x-user-id": dutyId,
    },
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId,
      description: `Плановый осмотр ветрогенератора ВЭУ-04. ${testMarker}`,
      priority: "HIGH",
      initialDeadline: new Date(Date.now() + 86400000).toISOString(),
    }),
  });

  assert.equal(createRes.status, 201);
  const createdRaw: unknown = await createRes.json();
  const created = ticketResponseSchema.parse(createdRaw);
  const location = `/api/requests/${created.id}`;
  assert.equal(createRes.headers.get("location"), location);
  assert.equal(created.type, "INSPECTION");
  assert.equal(created.status, "NEW");
  assert.equal(created.source, "MANUAL");

  console.log("[Smoke] Step 2: Reading ticket and verifying initial audit log...");
  const readRes = await fetch(`${base}${location}`);
  assert.equal(readRes.status, 200);
  const readRaw: unknown = await readRes.json();
  const readDetails = ticketDetailResponseSchema.parse(readRaw);
  assert.equal(readDetails.id, created.id);
  assert.equal(readDetails.auditLogs.length, 1);
  assert.equal(readDetails.auditLogs[0]?.action, "CREATED");

  console.log("[Smoke] Step 3: Assigning engineer to ticket...");
  const assignRes = await fetch(`${base}${location}/assignment`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-role": "DUTY",
      "x-user-id": dutyId,
    },
    body: JSON.stringify({
      assigneeId: engineerId,
      comment: "Назначен дежурный сервисный инженер",
    }),
  });
  assert.equal(assignRes.status, 200);
  const assigned = ticketDetailResponseSchema.parse(await assignRes.json());
  assert.equal(assigned.assigneeId, engineerId);
  const assignLog = assigned.auditLogs.find((l) => l.action === "ASSIGNED");
  assert.ok(assignLog);

  console.log("[Smoke] Step 4: Engineer starts ticket (NEW -> IN_PROGRESS)...");
  const startRes = await fetch(`${base}${location}/transitions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": "ENGINEER",
      "x-user-id": engineerId,
    },
    body: JSON.stringify({
      toStatus: "IN_PROGRESS",
      comment: "Инженер прибыл на объект, приступает к осмотру",
    }),
  });
  assert.equal(startRes.status, 200);
  const started = ticketDetailResponseSchema.parse(await startRes.json());
  assert.equal(started.status, "IN_PROGRESS");

  console.log("[Smoke] Step 5: Verifying mandatory completion comment validation...");
  const emptyCloseRes = await fetch(`${base}${location}/transitions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": "ENGINEER",
      "x-user-id": engineerId,
    },
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: "   ",
    }),
  });
  await expectProblem(emptyCloseRes, 400, `${location}/transitions`);

  console.log("[Smoke] Step 6: Completing ticket with detailed report...");
  const closeComment = "Осмотр завершён успешно, дефектов не обнаружено.";
  const completeRes = await fetch(`${base}${location}/transitions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": "ENGINEER",
      "x-user-id": engineerId,
    },
    body: JSON.stringify({
      toStatus: "COMPLETED",
      comment: closeComment,
    }),
  });
  assert.equal(completeRes.status, 200);
  const completed = ticketDetailResponseSchema.parse(await completeRes.json());
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.completionComment, closeComment);
  assert.ok(completed.completedAt);

  console.log("[Smoke] Step 7: Testing conversion from INSPECTION to REPAIR...");
  const createForConvertRes = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-role": "DUTY" },
    body: JSON.stringify({
      type: "INSPECTION",
      equipmentId,
      description: "Осмотр для перевода в ремонт",
    }),
  });
  const ticketForConvert = ticketResponseSchema.parse(await createForConvertRes.json());

  const convertRes = await fetch(`${base}/api/requests/${ticketForConvert.id}/convert-to-repair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-role": "ENGINEER" },
    body: JSON.stringify({
      comment: "Обнаружена течь масла редуктора, требуется дефектовка и ремонт",
    }),
  });
  assert.equal(convertRes.status, 200);
  const converted = ticketDetailResponseSchema.parse(await convertRes.json());
  assert.equal(converted.type, "REPAIR");

  console.log("[Smoke] Step 8: Verifying analytics endpoints...");
  const overdueRes = await fetch(`${base}/api/requests/analytics/overdue`);
  assert.equal(overdueRes.status, 200);
  const overdueData = ticketListResponseSchema.parse(await overdueRes.json());
  assert.ok(Array.isArray(overdueData.items));

  const workloadRes = await fetch(`${base}/api/requests/analytics/workload`);
  assert.equal(workloadRes.status, 200);
  const workloadData = workloadListResponseSchema.parse(await workloadRes.json());
  assert.ok(Array.isArray(workloadData.items));

  console.log("[Smoke] Step 9: Verifying error handling (400, 404, 415)...");
  const nonExistentId = randomUUID();
  await expectProblem(
    await fetch(`${base}/api/requests/${nonExistentId}`),
    404,
    `/api/requests/${nonExistentId}`,
  );
  await expectProblem(
    await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-role": "DUTY" },
      body: JSON.stringify({ invalid: true }),
    }),
    400,
    "/api/requests",
  );
  await expectProblem(
    await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-user-role": "DUTY" },
      body: "text",
    }),
    415,
    "/api/requests",
  );
} catch (error) {
  failed = true;
  console.error("Requests HTTP smoke failed with error:", error);
} finally {
  try {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  } catch {
    failed = true;
  }
  if (db) {
    try {
      await db.$disconnect();
    } catch {
      failed = true;
    }
  }
}

if (failed) {
  console.error("Requests HTTP smoke failed. Check the error log above.");
  process.exitCode = 1;
} else {
  console.log(
    "Requests HTTP smoke passed: create, read, assign engineer, start work, mandatory comment on complete, convert to repair, analytics, error handling.",
  );
}
