import { once } from "node:events";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.ts";
import { apiErrorHandler } from "../src/http/problem.ts";
import { generateOpenApi } from "../src/http/openapi.ts";
import { createEquipmentModule } from "../src/modules/equipment/router.ts";

describe("equipment API", () => {
  it("paginates, validates inputs and publishes both routes", async () => {
    const rows = [
      {
        id: "8e5c7ee2-5f05-4f40-b6a2-c62bce1c5328",
        externalId: "40000006",
        name: "Генератор",
        type: "GENERATOR",
      },
    ];
    const count = vi.fn().mockReturnValue(Promise.resolve(40));
    const findMany = vi.fn().mockReturnValue(Promise.resolve(rows));
    const findUnique = vi.fn().mockResolvedValue(null);
    const db = {
      equipment: { count, findMany, findUnique },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as Database;
    const module = createEquipmentModule(db);
    const doc = generateOpenApi([module]);
    expect(doc.paths).toHaveProperty("/api/equipment");
    expect(doc.paths).toHaveProperty("/api/equipment/{id}");
    const app = express();
    app.use(module.router);
    app.use(apiErrorHandler);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/equipment?page=2&pageSize=20&search=генератор`);
      expect(await response.json()).toEqual({ items: rows, page: 2, pageSize: 20, total: 40 });
      expect(findMany.mock.calls[0]?.[0]).toMatchObject({
        skip: 20,
        take: 20,
        where: {
          OR: [
            { name: { contains: "генератор", mode: "insensitive" } },
            { externalId: { contains: "генератор", mode: "insensitive" } },
          ],
        },
      });
      expect((await fetch(`${base}/api/equipment?page=0`)).status).toBe(400);
      expect((await fetch(`${base}/api/equipment?pageSize=101`)).status).toBe(400);
      expect((await fetch(`${base}/api/equipment/not-a-uuid`)).status).toBe(400);
      expect((await fetch(`${base}/api/equipment/${rows[0]?.id}`)).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
