import Fastify, { type FastifyInstance } from "fastify";

import { registerDashboardRoute } from "./routes/dashboard.js";
import { registerHealthRoute } from "./routes/health.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(registerHealthRoute);
  void app.register(registerDashboardRoute);

  return app;
}
