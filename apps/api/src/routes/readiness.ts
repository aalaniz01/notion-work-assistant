import type { FastifyInstance } from "fastify";

export interface ReadinessChecker {
  isReady(): Promise<boolean>;
}

interface ReadinessRouteOptions {
  readiness: ReadinessChecker;
}

export async function registerReadinessRoute(
  app: FastifyInstance,
  options: ReadinessRouteOptions,
): Promise<void> {
  app.get("/health/ready", async (_request, reply) => {
    if (await options.readiness.isReady()) {
      return { status: "ready" as const, database: "ok" as const };
    }

    return reply.status(503).send({
      status: "not_ready" as const,
      database: "unreachable" as const,
    });
  });
}
