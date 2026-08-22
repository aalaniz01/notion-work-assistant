import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AuthenticationUnavailableError } from "../auth/errors.js";
import { authenticateRequest } from "../auth/request-authentication.js";
import type {
  RequestSessionService,
  WorkspaceAuthorizationService,
} from "../auth/types.js";
import type { DashboardService } from "../dashboard/dashboard-service.js";
import { NotionUnavailableError } from "../dashboard/notion-unavailable.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DashboardRouteOptions {
  dashboard: DashboardService;
  sessions: RequestSessionService;
  workspaceAuthorization: WorkspaceAuthorizationService;
}

export async function registerDashboardRoute(
  app: FastifyInstance,
  options: DashboardRouteOptions,
): Promise<void> {
  app.get(
    "/api/workspaces/:workspaceId/dashboard",
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store");
        let principal;
        try {
          principal = await authenticateRequest(request, options.sessions);
        } catch (error) {
          if (error instanceof AuthenticationUnavailableError) {
            return reply
              .status(503)
              .send({ error: { code: "AUTH_UNAVAILABLE" as const } });
          }
          throw error;
        }

        if (!principal) {
          return reply
            .status(401)
            .send({ error: { code: "UNAUTHENTICATED" as const } });
        }

        const { workspaceId } = request.params as { workspaceId: string };
        if (!UUID_PATTERN.test(workspaceId)) {
          return reply
            .status(400)
            .send({ error: { code: "INVALID_WORKSPACE_ID" as const } });
        }

        let authorized: boolean;
        try {
          authorized = await options.workspaceAuthorization.hasAccess(
            principal.userId,
            workspaceId,
          );
        } catch (error) {
          if (error instanceof AuthenticationUnavailableError) {
            return reply
              .status(503)
              .send({ error: { code: "AUTH_UNAVAILABLE" as const } });
          }
          throw error;
        }

        if (!authorized) {
          return reply
            .status(403)
            .send({ error: { code: "FORBIDDEN" as const } });
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      try {
        return await options.dashboard.loadDashboard(workspaceId);
      } catch (error) {
        if (error instanceof NotionUnavailableError) {
          return reply
            .status(503)
            .send({ error: { code: "NOTION_UNAVAILABLE" as const } });
        }
        throw error;
      }
    },
  );
}
