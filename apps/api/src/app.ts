import Fastify, { type FastifyInstance } from "fastify";

import { registerDashboardRoute } from "./routes/dashboard.js";
import { registerHealthRoute } from "./routes/health.js";
import {
  registerReadinessRoute,
  type ReadinessChecker,
} from "./routes/readiness.js";

interface BuildAppOptions {
  closeDatabase?: () => Promise<void>;
  readiness?: ReadinessChecker;
}

const unavailableReadiness: ReadinessChecker = {
  async isReady() {
    return false;
  },
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(registerHealthRoute);
  void app.register(registerReadinessRoute, {
    readiness: options.readiness ?? unavailableReadiness,
  });
  void app.register(registerDashboardRoute);
  if (options.closeDatabase) {
    app.addHook("onClose", options.closeDatabase);
  }

  return app;
}
