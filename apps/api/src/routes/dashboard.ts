import type {
  Dashboard,
  DashboardRecommendation,
} from "@notion-work-assistant/domain";
import { calculatePriority } from "@notion-work-assistant/priority-engine";
import type { FastifyInstance } from "fastify";

import { clients, tasks } from "../data/fake-dashboard.js";

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
): Promise<void> {
  app.get("/api/dashboard", async () => buildDashboard());
}
