import { z } from "zod";
export const loginSchema = z.strictObject({
  login: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});
export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(["DUTY", "ENGINEER", "DIRECTOR"]),
});
export const loginResponseSchema = z.object({ token: z.string(), user: userSchema });
