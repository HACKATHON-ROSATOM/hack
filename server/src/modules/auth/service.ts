import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database } from "../../database.ts";

const scrypt = promisify(scryptCallback);
export type AuthUser = { id: string; name: string; role: "DUTY" | "ENGINEER" | "DIRECTOR" };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash, extra] = stored.split(":");
  if (
    !salt ||
    !hash ||
    extra !== undefined ||
    !/^[0-9a-f]{32}$/.test(salt) ||
    !/^[0-9a-f]{128}$/.test(hash)
  )
    return false;
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(actual, expected);
}

export function createAuthService(db: Database) {
  const sessions = new Map<string, AuthUser>();
  return {
    async login(
      login: string,
      password: string,
    ): Promise<{ token: string; user: AuthUser } | null> {
      const record = await db.user.findUnique({ where: { login } });
      const dummy = "00000000000000000000000000000000:" + "0".repeat(128);
      const valid = await verifyPassword(password, record?.passwordHash ?? dummy);
      if (!record || !valid) return null;
      const user = { id: record.id, name: record.fullName, role: record.role };
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, user);
      return { token, user };
    },
    authenticate(authorization: string | undefined): AuthUser | null {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
      return match?.[1] ? (sessions.get(match[1]) ?? null) : null;
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
