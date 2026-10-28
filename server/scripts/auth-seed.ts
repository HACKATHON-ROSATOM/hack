import { createDatabase } from "../src/database.ts";
import { hashPassword } from "../src/modules/auth/service.ts";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
const db = createDatabase(process.env.DATABASE_URL);
const users = [
  {
    id: "6e7270af-021d-4c31-9c49-c22d94d17c5b",
    login: "duty",
    password: "demo-duty-2026",
    fullName: "Дежурный",
    role: "DUTY" as const,
  },
  {
    id: "17f570cb-e70b-418b-b7d0-409e5ee19697",
    login: "engineer",
    password: "demo-engineer-2026",
    fullName: "Сервисный инженер",
    role: "ENGINEER" as const,
  },
  {
    id: "5dbb285c-7deb-4a2a-a961-c24a6860afdc",
    login: "director",
    password: "demo-director-2026",
    fullName: "Директор",
    role: "DIRECTOR" as const,
  },
];
try {
  for (const { password, ...user } of users) {
    await db.user.upsert({
      where: { id: user.id },
      update: {},
      create: { ...user, passwordHash: await hashPassword(password) },
    });
  }
  console.log("Демонстрационные пользователи созданы");
} finally {
  await db.$disconnect();
}
