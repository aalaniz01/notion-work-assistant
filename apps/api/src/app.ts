import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import { AuthenticationUnavailableError } from "./auth/errors.js";
import type { ApplicationSessionConfiguration } from "./auth/oidc-config.js";
import {
  isValidSessionToken,
  type SessionService,
} from "./auth/session-service.js";
import type {
  RequestSessionService,
  WorkspaceAuthorizationService,
} from "./auth/types.js";
import type { DashboardService } from "./dashboard/dashboard-service.js";
import { NotionUnavailableError } from "./dashboard/notion-unavailable.js";
import { registerDashboardRoute } from "./routes/dashboard.js";
import {
  registerAuthLifecycleRoutes,
  type OidcRouteRuntime,
} from "./routes/auth-lifecycle.js";
import { registerHealthRoute } from "./routes/health.js";
import {
  registerReadinessRoute,
  type ReadinessChecker,
} from "./routes/readiness.js";
import { registerSessionRoute } from "./routes/session.js";

export interface BuildAppOptions {
  authentication?: RequestSessionService;
  closeDatabase?: () => Promise<void>;
  dashboard?: DashboardService;
  oidc?: OidcRouteRuntime;
  readiness?: ReadinessChecker;
  sessions?: SessionService;
  sessionCookies?: ApplicationSessionConfiguration;
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

const unavailableSessions: SessionService = {
  ...unavailableAuthentication,
  async create() {
    throw new AuthenticationUnavailableError();
  },
  async revoke(rawToken) {
    if (!isValidSessionToken(rawToken)) return;
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

const unavailableDashboard: DashboardService = {
  async loadDashboard() {
    throw new NotionUnavailableError("NOTION_UNAVAILABLE");
  },
};

interface AuthenticatedApiOptions {
  authentication: RequestSessionService;
  dashboard: DashboardService;
  oidc?: OidcRouteRuntime;
  sessions: SessionService;
  sessionCookies?: ApplicationSessionConfiguration;
  workspaceAuthorization: WorkspaceAuthorizationService;
}

async function registerAuthenticatedApi(
  app: FastifyInstance,
  options: AuthenticatedApiOptions,
): Promise<void> {
  await app.register(cookie);
  await app.register(registerAuthLifecycleRoutes, {
    oidc: options.oidc,
    sessions: options.sessions,
    sessionCookies: options.sessionCookies,
  });
  await app.register(registerSessionRoute, {
    sessions: options.authentication,
    workspaceAuthorization: options.workspaceAuthorization,
  });
  await app.register(registerDashboardRoute, {
    dashboard: options.dashboard,
    sessions: options.authentication,
    workspaceAuthorization: options.workspaceAuthorization,
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const sessions = options.sessions ?? unavailableSessions;
  const authentication =
    options.authentication ?? options.sessions ?? unavailableAuthentication;
  const workspaceAuthorization =
    options.workspaceAuthorization ?? unavailableWorkspaceAuthorization;
  const dashboard = options.dashboard ?? unavailableDashboard;

  void app.register(registerHealthRoute);
  void app.register(registerReadinessRoute, {
    readiness: options.readiness ?? unavailableReadiness,
  });
  void app.register(registerAuthenticatedApi, {
    authentication,
    dashboard,
    oidc: options.oidc,
    sessions,
    sessionCookies:
      options.sessionCookies ??
      (options.oidc
        ? {
            applicationOrigin: options.oidc.applicationOrigin,
            secureCookies: options.oidc.secureCookies,
          }
        : undefined),
    workspaceAuthorization,
  });
  if (options.closeDatabase) {
    app.addHook("onClose", options.closeDatabase);
  }

  return app;
}
