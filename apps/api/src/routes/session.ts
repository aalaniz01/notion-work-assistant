import type { FastifyInstance } from "fastify";

import { AuthenticationUnavailableError } from "../auth/errors.js";
import { authenticateRequest } from "../auth/request-authentication.js";
import type {
  RequestSessionService,
  WorkspaceAuthorizationService,
} from "../auth/types.js";

interface SessionRouteOptions {
  sessions: RequestSessionService;
  workspaceAuthorization: WorkspaceAuthorizationService;
}

export async function registerSessionRoute(
  app: FastifyInstance,
  options: SessionRouteOptions,
): Promise<void> {
  app.get("/api/auth/session", async (request, reply) => {
    try {
      const principal = await authenticateRequest(request, options.sessions);
      if (!principal) return { authenticated: false as const };

      const workspaces =
        await options.workspaceAuthorization.listAuthorizedWorkspaces(
          principal.userId,
        );
      return { authenticated: true as const, workspaces };
    } catch (error) {
      if (error instanceof AuthenticationUnavailableError) {
        return reply
          .status(503)
          .send({ error: { code: "AUTH_UNAVAILABLE" as const } });
      }
      throw error;
    }
  });
}
