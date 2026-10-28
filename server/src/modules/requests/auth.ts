import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "./types.ts";

const TOKEN_SECRET = process.env.SESSION_SECRET || "hackathon-toir-secret-2026-requests";

export interface AuthUser {
  id: string;
  username: string;
  password: string;
  fullName: string;
  role: "DUTY" | "ENGINEER" | "DIRECTOR";
}

export const PREDEFINED_USERS = {
  duty: {
    id: "11111111-1111-4111-8111-111111111111",
    username: "duty",
    password: "duty123",
    fullName: "Дежурный диспетчер",
    role: "DUTY" as const,
  },
  engineer: {
    id: "22222222-2222-4222-8222-222222222222",
    username: "engineer",
    password: "engineer123",
    fullName: "Сменный инженер",
    role: "ENGINEER" as const,
  },
  director: {
    id: "33333333-3333-4333-8333-333333333333",
    username: "director",
    password: "director123",
    fullName: "Главный директор",
    role: "DIRECTOR" as const,
  },
};

interface TokenPayload {
  userId: string;
  role: UserRole;
  exp: number;
}

export function signToken(userId: string, role: UserRole): string {
  const payload: TokenPayload = {
    userId,
    role,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyToken(token: string): { userId: string; role: UserRole } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expectedSignature = createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!payload.userId || !payload.role) return null;
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

export function authenticate(username: string, password: string) {
  const user = (PREDEFINED_USERS as Record<string, AuthUser | undefined>)[
    username.toLowerCase().trim()
  ];
  if (!user || user.password !== password) {
    return null;
  }
  const token = signToken(user.id, user.role);
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    },
  };
}

export function findUserById(id: string) {
  for (const user of Object.values(PREDEFINED_USERS)) {
    if (user.id === id) {
      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      };
    }
  }
  return null;
}
