import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import { AuthenticationUnavailableError } from "./auth/errors.js";
import { isValidSessionToken } from "./auth/session-service.js";
import type {
  RequestSessionService,
  WorkspaceAuthorizationService,
} from "./auth/types.js";
import { registerDashboardRoute } from "./routes/dashboard.js";
import { registerHealthRoute } from "./routes/health.js";
import {
  registerReadinessRoute,
  type ReadinessChecker,
} from "./routes/readiness.js";
import { registerSessionRoute } from "./routes/session.js";

export interface BuildAppOptions {
  authentication?: RequestSessionService;
  closeDatabase?: () => Promise<void>;
  readiness?: ReadinessChecker;
  workspaceAuthorization?: WorkspaceAuthorizationService;
}

const unavailableReadiness: ReadinessChecker = {
  async isReady() {
    return false;
  },
};

const unavailableAuthentication: RequestSessionService = {
  async authenticate(rawToken) {
    if (!isValidSessionToken(rawToken)) return null;
    throw new AuthenticationUnavailableError();
  },
};

const unavailableWorkspaceAuthorization: WorkspaceAuthorizationService = {
  async listAuthorizedWorkspaces() {
    throw new AuthenticationUnavailableError();
  },
  async hasAccess() {
    throw new AuthenticationUnavailableError();
  },
};

interface AuthenticatedApiOptions {
  authentication: RequestSessionService;
  workspaceAuthorization: WorkspaceAuthorizationService;
}

async function registerAuthenticatedApi(
  app: FastifyInstance,
  options: AuthenticatedApiOptions,
): Promise<void> {
  await app.register(cookie);
  await app.register(registerSessionRoute, {
    sessions: options.authentication,
    workspaceAuthorization: options.workspaceAuthorization,
  });
  await app.register(registerDashboardRoute, {
    sessions: options.authentication,
    workspaceAuthorization: options.workspaceAuthorization,
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const authentication = options.authentication ?? unavailableAuthentication;
  const workspaceAuthorization =
    options.workspaceAuthorization ?? unavailableWorkspaceAuthorization;

  void app.register(registerHealthRoute);
  void app.register(registerReadinessRoute, {
    readiness: options.readiness ?? unavailableReadiness,
  });
  void app.register(registerAuthenticatedApi, {
    authentication,
    workspaceAuthorization,
  });
  if (options.closeDatabase) {
    app.addHook("onClose", options.closeDatabase);
  }

  return app;
}
