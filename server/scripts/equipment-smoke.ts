import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
const db = createDatabase(process.env.DATABASE_URL);
const app = createApp(db);
const server = app.listen(0, "127.0.0.1");
try {
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const first = await fetch(`${base}/api/equipment?page=1&pageSize=20`);
  assert.equal(first.status, 200);
  const data = (await first.json()) as {
    items: { id: string; externalId: string }[];
    page: number;
    pageSize: number;
    total: number;
  };
  assert.equal(data.total, 40);
  assert.equal(data.items.length, 20);
  assert.equal(data.page, 1);
  assert.equal(data.pageSize, 20);
  const generator = data.items.find((item) => item.externalId === "40000006");
  assert.ok(generator);
  const detail = await fetch(`${base}/api/equipment/${generator.id}`);
  assert.equal(detail.status, 200);
  const body = (await detail.json()) as { externalId: string; history: unknown[] };
  assert.equal(body.externalId, "40000006");
  assert.deepEqual(body.history, []);
  const openapi = await fetch(`${base}/openapi.json`);
  assert.equal(openapi.status, 200);
  const doc = (await openapi.json()) as { paths?: Record<string, unknown> };
  assert.ok(doc.paths?.["/api/equipment"] && doc.paths?.["/api/equipment/{id}"]);
  assert.equal(await db.maintenanceRecord.count(), 1339);
  assert.equal(await db.maintenanceRecord.count({ where: { equipmentId: null } }), 898);
  console.log("Проверка оборудования, истории и OpenAPI пройдена");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.$disconnect();
}
