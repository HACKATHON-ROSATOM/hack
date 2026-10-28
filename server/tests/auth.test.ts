import { once } from "node:events";
import express from "express";
import { describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { ApiError, apiErrorHandler } from "../src/http/problem.ts";
import { generateOpenApi } from "../src/http/openapi.ts";
import { createAuthModule } from "../src/modules/auth/router.ts";
import { createAuthService, hashPassword } from "../src/modules/auth/service.ts";

describe("authentication", () => {
  it("authenticates three roles and rejects invalid credentials and sessions", async () => {
    const users = await Promise.all(
      [
        {
          id: "6e7270af-021d-4c31-9c49-c22d94d17c5b",
          login: "duty",
          fullName: "Дежурный",
          role: "DUTY" as const,
        },
        {
          id: "17f570cb-e70b-418b-b7d0-409e5ee19697",
          login: "engineer",
          fullName: "Инженер",
          role: "ENGINEER" as const,
        },
        {
          id: "5dbb285c-7deb-4a2a-a961-c24a6860afdc",
          login: "director",
          fullName: "Директор",
          role: "DIRECTOR" as const,
        },
      ].map(async (user) => ({ ...user, passwordHash: await hashPassword("demo-password") })),
    );
    const db = {
      user: {
        findUnique: async ({ where }: { where: { login: string } }) =>
          users.find((user) => user.login === where.login) ?? null,
      },
    } as unknown as Database;
    const auth = createAuthService(db);
    const module = createAuthModule(auth);
    const document = generateOpenApi([module]);
    expect(document.paths?.["/api/auth/login"]?.post?.description).toContain(
      "Параметры запроса не поддерживаются",
    );
    const app = express();
    app.use(express.json());
    app.use(module.router);
    app.get("/denied", () => {
      throw new ApiError(403, "Forbidden.");
    });
    app.use(apiErrorHandler);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;
    const login = (body: unknown) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Role": "DIRECTOR" },
        body: JSON.stringify(body),
      });
    try {
      for (const expected of users) {
        const response = await login({ login: expected.login, password: "demo-password" });
        expect(response.status).toBe(200);
        const result = (await response.json()) as { token: string; user: AuthUserForTest };
        expect(result.user).toEqual({
          id: expected.id,
          name: expected.fullName,
          role: expected.role,
        });
        expect(auth.authenticate(`Bearer ${result.token}`)).toEqual(result.user);
        expect(createAuthService(db).authenticate(`Bearer ${result.token}`)).toBeNull();
        const headers = { Authorization: `Bearer ${result.token}` };
        const current = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, { headers });
        expect(current.status).toBe(200);
        expect(await current.json()).toEqual(result.user);
        const logout = await fetch(`http://127.0.0.1:${address.port}/api/auth/logout`, {
          method: "POST",
          headers,
        });
        expect(logout.status).toBe(204);
        expect(auth.authenticate(`Bearer ${result.token}`)).toBeNull();
        expect(
          (await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, { headers })).status,
        ).toBe(401);
      }
      const wrong = await login({ login: "duty", password: "wrong" });
      const missing = await login({ login: "missing", password: "wrong" });
      expect(wrong.status).toBe(401);
      expect(wrong.headers.get("content-type")).toContain("application/problem+json");
      expect(await wrong.json()).toEqual(await missing.json());
      const query = await fetch(`${url}?unexpected=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: "duty", password: "demo-password" }),
      });
      expect(query.status).toBe(400);
      expect((await query.json()).instance).toBe("/api/auth/login");
      const denied = await fetch(`http://127.0.0.1:${address.port}/denied?token=private`);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ status: 403, instance: "/denied" });
      expect((await login({ login: "duty" })).status).toBe(400);
      expect(auth.authenticate(undefined)).toBeNull();
      expect(auth.authenticate("Bearer invalid")).toBeNull();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
type AuthUserForTest = { id: string; name: string; role: string };
