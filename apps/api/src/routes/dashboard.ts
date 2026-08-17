import type {
  Dashboard,
  DashboardRecommendation,
} from "@notion-work-assistant/domain";
import { calculatePriority } from "@notion-work-assistant/priority-engine";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AuthenticationUnavailableError } from "../auth/errors.js";
import { authenticateRequest } from "../auth/request-authentication.js";
import type {
  RequestSessionService,
  WorkspaceAuthorizationService,
} from "../auth/types.js";
import { clients, tasks } from "../data/fake-dashboard.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DashboardRouteOptions {
  sessions: RequestSessionService;
  workspaceAuthorization: WorkspaceAuthorizationService;
}

function buildDashboard(): Dashboard {
  const recommendations: DashboardRecommendation[] = [];

  for (const task of tasks) {
    const result = calculatePriority(task);
    if (!result.eligible) continue;

    recommendations.push({
      task,
      priority: {
        recommendationScore: result.recommendationScore,
        priorityLevel: result.priorityLevel,
      },
    });
  }

  recommendations.sort(
    (left, right) =>
      right.priority.recommendationScore - left.priority.recommendationScore ||
      left.task.id.localeCompare(right.task.id),
  );

  return { clients, recommendations };
}

export async function registerDashboardRoute(
  app: FastifyInstance,
  options: DashboardRouteOptions,
): Promise<void> {
  app.get(
    "/api/workspaces/:workspaceId/dashboard",
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
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
    async () => buildDashboard(),
  );
}
