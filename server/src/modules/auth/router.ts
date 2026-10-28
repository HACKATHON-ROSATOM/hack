import { createApiModule, problemResponse, type ApiModule } from "../../http/openapi.ts";
import { ApiError } from "../../http/problem.ts";
import type { AuthService } from "./service.ts";
import { loginResponseSchema, loginSchema } from "./schemas.ts";

export function createAuthModule(auth: AuthService): ApiModule {
  const api = createApiModule();
  api.register(
    {
      method: "post",
      path: "/api/auth/login",
      operationId: "login",
      summary: "Sign in",
      request: {
        body: { required: true, content: { "application/json": { schema: loginSchema } } },
      },
      responses: {
        200: {
          description: "Authenticated",
          content: { "application/json": { schema: loginResponseSchema } },
        },
        400: problemResponse("Invalid input"),
        401: problemResponse("Invalid credentials"),
        415: problemResponse("Expected JSON"),
        500: problemResponse("Internal error"),
      },
    },
    async (req, res) => {
      if (!req.is("application/json")) throw new ApiError(415, "Expected application/json.");
      const body = loginSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, "Invalid login input.");
      const result = await auth.login(body.data.login, body.data.password);
      if (!result) {
        res.status(401).type("application/problem+json").json({
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "Invalid credentials.",
          instance: req.path,
        });
        return;
      }
      res.set("Cache-Control", "no-store").json(result);
    },
  );
  return api;
}
