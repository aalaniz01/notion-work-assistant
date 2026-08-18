import type {
  SessionAuthenticationRecord,
  SessionRepository,
  UserAuthenticationRecord,
} from "@notion-work-assistant/db";
import { afterEach, describe, expect, it } from "vitest";

import {
  ApplicationSessionService,
  hashSessionToken,
} from "./auth/session-service.js";
import type {
  RequestSessionService,
  WorkspaceAuthorizationService,
} from "./auth/types.js";
import { buildApp } from "./app.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_TOKEN = "a".repeat(43);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const apps: ReturnType<typeof buildApp>[] = [];

class CookieSessionRepository implements SessionRepository {
  lookupCount = 0;

  constructor(
    private readonly expectedTokenHash: string,
    readonly session: SessionAuthenticationRecord | null,
  ) {}

  async findUserById(): Promise<UserAuthenticationRecord | null> {
    throw new Error("Not used by request authentication");
  }

  async create(): Promise<void> {
    throw new Error("Not used by request authentication");
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<SessionAuthenticationRecord | null> {
    this.lookupCount += 1;
    return tokenHash === this.expectedTokenHash ? this.session : null;
  }

  async revoke(): Promise<void> {
    throw new Error("Not used by request authentication");
  }
}

function authenticatedServices(options: { authorized?: boolean } = {}): {
  authentication: RequestSessionService;
  workspaceAuthorization: WorkspaceAuthorizationService;
} {
  return {
    authentication: {
      async authenticate() {
        return { userId: "user-1" };
      },
    },
    workspaceAuthorization: {
      async listAuthorizedWorkspaces() {
        return [{ id: WORKSPACE_ID, name: "Workspace" }];
      },
      async hasAccess() {
        return options.authorized ?? true;
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("API", () => {
  it("returns process health without invoking authentication", async () => {
    let authenticationCount = 0;
    const app = buildApp({
      authentication: {
        async authenticate() {
          authenticationCount += 1;
          return null;
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { cookie: "malformed-cookie" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(authenticationCount).toBe(0);
  });

  it("returns database readiness without invoking authentication", async () => {
    let authenticationCount = 0;
    const app = buildApp({
      authentication: {
        async authenticate() {
          authenticationCount += 1;
          return null;
        },
      },
      readiness: { isReady: async () => true },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", database: "ok" });
    expect(authenticationCount).toBe(0);
  });

  it("returns unavailable readiness without database connectivity", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "not_ready",
      database: "unreachable",
    });
  });

  it("closes the application database exactly once", async () => {
    let closeCount = 0;
    const app = buildApp({
      closeDatabase: async () => {
        closeCount += 1;
      },
    });
    apps.push(app);

    await app.close();
    await app.close();

    expect(closeCount).toBe(1);
  });

  it("reports anonymous session state with HTTP 200", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });

  it("rejects duplicate session cookies without selecting either value", async () => {
    let receivedToken: string | undefined;
    const app = buildApp({
      authentication: {
        async authenticate(token) {
          receivedToken = token;
          return token ? { userId: "user-1" } : null;
        },
      },
      workspaceAuthorization: {
        listAuthorizedWorkspaces: async () => [],
        hasAccess: async () => false,
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: `nwa_session=${SESSION_TOKEN}; nwa_session=${"b".repeat(43)}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
    expect(receivedToken).toBeUndefined();
  });

  it("treats a malformed cookie as anonymous when storage is unavailable", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: "nwa_session=malformed" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });

  it("fails closed for a well-formed cookie when storage is unavailable", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `nwa_session=${SESSION_TOKEN}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "AUTH_UNAVAILABLE" } });
  });

  it("returns authorized workspaces for an authenticated session", async () => {
    let receivedTokenHash: string | undefined;
    const services = authenticatedServices();
    services.authentication = {
      async authenticate(token) {
        receivedTokenHash = token ? hashSessionToken(token) : undefined;
        return { userId: "user-1" };
      },
    };
    const app = buildApp(services);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `nwa_session=${SESSION_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      workspaces: [{ id: WORKSPACE_ID, name: "Workspace" }],
    });
    expect(receivedTokenHash).toBe(hashSessionToken(SESSION_TOKEN));
  });

  it.each(["expired", "revoked", "disabled"])(
    "reports %s sessions as signed out",
    async () => {
      const app = buildApp({
        authentication: { authenticate: async () => null },
      });
      apps.push(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { cookie: `nwa_session=${SESSION_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ authenticated: false });
    },
  );

  it("removes anonymous access to the legacy dashboard route", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/dashboard" });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("recommendations");
  });

  it("authenticates before validating a malformed workspace ID", async () => {
    let authorizationCount = 0;
    const app = buildApp({
      authentication: { authenticate: async () => null },
      workspaceAuthorization: {
        listAuthorizedWorkspaces: async () => [],
        hasAccess: async () => {
          authorizationCount += 1;
          return true;
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/not-a-uuid/dashboard",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
    expect(authorizationCount).toBe(0);
  });

  it("returns 401 for a malformed cookie before workspace processing", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/not-a-uuid/dashboard",
      headers: { cookie: "nwa_session=malformed" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });

  it("returns 503 for a well-formed cookie when storage is unavailable", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/dashboard`,
      headers: { cookie: `nwa_session=${SESSION_TOKEN}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "AUTH_UNAVAILABLE" } });
  });

  it("validates workspace ID after authentication and before authorization", async () => {
    let authorizationCount = 0;
    const services = authenticatedServices();
    services.workspaceAuthorization.hasAccess = async () => {
      authorizationCount += 1;
      return true;
    };
    const app = buildApp(services);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/not-a-uuid/dashboard",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_WORKSPACE_ID" },
    });
    expect(authorizationCount).toBe(0);
  });

  it("rejects a workspace without active membership", async () => {
    const app = buildApp(authenticatedServices({ authorized: false }));
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/dashboard`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("authenticates a real session cookie before returning the fake dashboard", async () => {
    const rawSessionToken = "s".repeat(43);
    const repository = new CookieSessionRepository(
      hashSessionToken(rawSessionToken),
      {
        userId: "user-1",
        expiresAt: new Date("2026-01-01T01:00:00.000Z"),
        revokedAt: null,
        disabledAt: null,
      },
    );
    const authentication = new ApplicationSessionService(repository, {
      now: () => NOW,
    });
    const app = buildApp({
      ...authenticatedServices(),
      authentication,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/dashboard`,
      headers: { cookie: `nwa_session=${rawSessionToken}` },
    });
    const body = response.json<{
      recommendations: Array<{
        task: { id: string; status: string };
        priority: { recommendationScore: number };
      }>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.recommendations.map(({ task }) => task.status)).not.toContain(
      "APPROVED",
    );
    expect(body.recommendations.map(({ task }) => task.status)).not.toContain(
      "WAITING_APPROVAL",
    );
    expect(body.recommendations.map(({ task }) => task.id)).toEqual([
      "task-0",
      "task-1",
      "task-6",
      "task-2",
      "task-5",
    ]);
    expect(
      body.recommendations.map(({ priority }) => priority.recommendationScore),
    ).toEqual([72, 72, 72, 62, 34]);
    expect(repository.lookupCount).toBe(1);
  });

  it.each([
    {
      label: "missing",
      cookie: undefined,
      session: null,
      expectedLookups: 0,
    },
    {
      label: "malformed",
      cookie: "malformed",
      session: null,
      expectedLookups: 0,
    },
    {
      label: "expired",
      cookie: "e".repeat(43),
      session: {
        userId: "user-1",
        expiresAt: NOW,
        revokedAt: null,
        disabledAt: null,
      },
      expectedLookups: 1,
    },
    {
      label: "revoked",
      cookie: "r".repeat(43),
      session: {
        userId: "user-1",
        expiresAt: new Date("2026-01-01T01:00:00.000Z"),
        revokedAt: NOW,
        disabledAt: null,
      },
      expectedLookups: 1,
    },
  ] as const)(
    "does not authorize the dashboard for a $label session cookie",
    async ({ cookie, session, expectedLookups }) => {
      const expectedTokenHash = cookie
        ? hashSessionToken(cookie)
        : "0".repeat(64);
      const repository = new CookieSessionRepository(
        expectedTokenHash,
        session,
      );
      let authorizationCount = 0;
      const app = buildApp({
        authentication: new ApplicationSessionService(repository, {
          now: () => NOW,
        }),
        workspaceAuthorization: {
          listAuthorizedWorkspaces: async () => [],
          hasAccess: async () => {
            authorizationCount += 1;
            return true;
          },
        },
      });
      apps.push(app);

      const response = await app.inject({
        method: "GET",
        url: `/api/workspaces/${WORKSPACE_ID}/dashboard`,
        headers: cookie ? { cookie: `nwa_session=${cookie}` } : undefined,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
      expect(repository.lookupCount).toBe(expectedLookups);
      expect(authorizationCount).toBe(0);
    },
  );
});
