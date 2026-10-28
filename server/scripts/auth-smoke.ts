import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import { createAuthService } from "../src/modules/auth/service.ts";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
const db = createDatabase(process.env.DATABASE_URL);
const auth = createAuthService(db);
const server = createApp(db, auth).listen(0, "127.0.0.1");
try {
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const users = [
    {
      login: "duty",
      password: "demo-duty-2026",
      id: "6e7270af-021d-4c31-9c49-c22d94d17c5b",
      role: "DUTY",
    },
    {
      login: "engineer",
      password: "demo-engineer-2026",
      id: "17f570cb-e70b-418b-b7d0-409e5ee19697",
      role: "ENGINEER",
    },
    {
      login: "director",
      password: "demo-director-2026",
      id: "5dbb285c-7deb-4a2a-a961-c24a6860afdc",
      role: "DIRECTOR",
    },
  ];
  for (const expected of users) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Role": "DIRECTOR" },
      body: JSON.stringify({ login: expected.login, password: expected.password }),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      token: string;
      user: { id: string; name: string; role: string };
    };
    assert.equal(result.user.id, expected.id);
    assert.equal(result.user.role, expected.role);
    assert.deepEqual(auth.authenticate(`Bearer ${result.token}`), result.user);
    const restartedAuth = createAuthService(db);
    await restartedAuth.restoreSessions();
    assert.deepEqual(restartedAuth.authenticate(`Bearer ${result.token}`), result.user);
    await auth.logout(`Bearer ${result.token}`);
  }
  const wrong = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "duty", password: "wrong" }),
  });
  assert.equal(wrong.status, 401);
  const openapi = await fetch(`${base}/openapi.json`);
  const doc = (await openapi.json()) as { paths: Record<string, unknown> };
  assert.ok(doc.paths["/api/auth/login"]);
  console.log("Проверка входа для трёх ролей и OpenAPI пройдена");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.$disconnect();
}
