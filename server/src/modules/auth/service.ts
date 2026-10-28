import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database } from "../../database.ts";

const scrypt = promisify(scryptCallback);
const SESSION_MS = 8 * 60 * 60 * 1000;
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

function tokenFromAuthorization(authorization: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
  return match?.[1] ?? null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAuthService(db: Database) {
  const sessions = new Map<string, { user: AuthUser; expiresAt: number }>();
  return {
    async restoreSessions(): Promise<void> {
      const now = new Date();
      await db.authSession.deleteMany({ where: { expiresAt: { lte: now } } });
      const stored = await db.authSession.findMany({ include: { user: true } });
      for (const session of stored) {
        sessions.set(session.tokenHash, {
          user: { id: session.user.id, name: session.user.fullName, role: session.user.role },
          expiresAt: session.expiresAt.getTime(),
        });
      }
    },
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
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_MS);
      await db.authSession.create({ data: { tokenHash, userId: user.id, expiresAt } });
      sessions.set(tokenHash, { user, expiresAt: expiresAt.getTime() });
      return { token, user };
    },
    authenticate(authorization: string | undefined): AuthUser | null {
      const token = tokenFromAuthorization(authorization);
      if (!token) return null;
      const tokenHash = hashToken(token);
      const session = sessions.get(tokenHash);
      if (!session) return null;
      if (session.expiresAt <= Date.now()) {
        sessions.delete(tokenHash);
        return null;
      }
      return session.user;
    },
    async logout(authorization: string | undefined): Promise<boolean> {
      const token = tokenFromAuthorization(authorization);
      if (!token) return false;
      const tokenHash = hashToken(token);
      if (!sessions.has(tokenHash)) return false;
      await db.authSession.deleteMany({ where: { tokenHash } });
      return sessions.delete(tokenHash);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
