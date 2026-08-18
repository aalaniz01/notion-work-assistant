import type {
  ExternalIdentityRepository,
  ExternalIdentityUserRecord,
} from "@notion-work-assistant/db";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { AuthenticationUnavailableError } from "../auth/errors.js";
import { OidcLoginService } from "../auth/oidc-login-service.js";
import {
  OidcAccessDeniedError,
  OidcCallbackValidationError,
  type OidcProvider,
} from "../auth/oidc-provider.js";
import { OidcTransientStateService } from "../auth/oidc-transient-state.js";
import {
  hashSessionToken,
  type CreatedSession,
  type SessionService,
} from "../auth/session-service.js";
import { buildApp } from "../app.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const SESSION_EXPIRES_AT = new Date("2026-01-01T08:00:00.000Z");
const OLD_SESSION_TOKEN = "o".repeat(43);
const NEW_SESSION_TOKEN = "n".repeat(43);
const apps: FastifyInstance[] = [];

class FakeProvider implements OidcProvider {
  authorizationCount = 0;
  validationCount = 0;
  callbackFailure: unknown;
  receivedAttempt:
    | { state: string; nonce: string; codeVerifier: string }
    | undefined;
  state = "state-value";

  async createAuthorizationRequest() {
    this.authorizationCount += 1;
    return {
      url: new URL(
        "https://identity.example.test/authorize?client_id=client-id",
      ),
      state: this.state,
      nonce: "independent-nonce",
      codeVerifier: "pkce-verifier",
    };
  }

  async validateCallback(
    _callbackUrl: URL,
    attempt: { state: string; nonce: string; codeVerifier: string },
  ) {
    this.validationCount += 1;
    this.receivedAttempt = attempt;
    if (this.callbackFailure) throw this.callbackFailure;
    return {
      issuer: "https://identity.example.test",
      subject: "subject-1",
    };
  }
}

class FakeIdentityRepository implements ExternalIdentityRepository {
  user: ExternalIdentityUserRecord | null = {
    id: "user-1",
    disabledAt: null,
  };

  async findUserByIdentity() {
    return this.user;
  }
}

class FakeSessions implements SessionService {
  principal: { userId: string } | null = null;
  createdFor: string | undefined;
  revoked: string | undefined;
  revokeFailure = false;

  async authenticate(rawToken: string | undefined) {
    return rawToken ? this.principal : null;
  }

  async create(userId: string): Promise<CreatedSession> {
    this.createdFor = userId;
    return { token: NEW_SESSION_TOKEN, expiresAt: SESSION_EXPIRES_AT };
  }

  async revoke(rawToken: string | undefined) {
    if (this.revokeFailure) throw new AuthenticationUnavailableError();
    this.revoked = rawToken;
  }
}

function cookieLines(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string[] {
  const value = response.headers["set-cookie"];
  return Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
}

function cookiePair(
  response: {
    headers: Record<string, string | string[] | number | undefined>;
  },
  name: string,
): string {
  const line = cookieLines(response).find((value) =>
    value.startsWith(`${name}=`),
  );
  if (!line) throw new Error(`Expected ${name} cookie`);
  return line.split(";", 1)[0]!;
}

function redactCookieValues(lines: string[]): string[] {
  return lines.map((line) => line.replace(/^([^=]+=)[^;]*/, "$1<redacted>"));
}

function createTestApp(
  options: {
    identities?: FakeIdentityRepository;
    provider?: FakeProvider;
    sessions?: FakeSessions;
    transientState?: OidcTransientStateService;
  } = {},
) {
  const provider = options.provider ?? new FakeProvider();
  const identities = options.identities ?? new FakeIdentityRepository();
  const sessions = options.sessions ?? new FakeSessions();
  const transientState =
    options.transientState ??
    new OidcTransientStateService(new Uint8Array(32).fill(3), {
      now: () => NOW,
    });
  const app = buildApp({
    oidc: {
      applicationOrigin: new URL("https://assistant.example.test"),
      callbackUrl: new URL("https://assistant.example.test/api/auth/callback"),
      login: new OidcLoginService(provider, identities, sessions),
      now: () => NOW,
      secureCookies: true,
      transientState,
    },
    sessions,
  });
  apps.push(app);
  return { app, identities, provider, sessions };
}

async function startLogin(app: FastifyInstance) {
  const response = await app.inject({ method: "GET", url: "/api/auth/login" });
  return { response, attemptCookie: cookiePair(response, "nwa_oidc_attempt") };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("OIDC authentication lifecycle routes", () => {
  it("sets a protected callback-scoped attempt and redirects to the provider", async () => {
    const { app } = createTestApp();

    const { response } = await startLogin(app);
    const cookies = redactCookieValues(cookieLines(response));

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "https://identity.example.test/authorize?client_id=client-id",
    );
    expect(cookies).toContainEqual(
      expect.stringMatching(
        /^nwa_oidc_attempt=<redacted>; Max-Age=600; Path=\/api\/auth\/callback; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
      ),
    );
  });

  it("ignores browser-controlled redirect destinations", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/login?returnTo=https://attacker.example.test",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "https://identity.example.test/authorize?client_id=client-id",
    );
  });

  it("redirects an already-authenticated browser without starting OIDC", async () => {
    const sessions = new FakeSessions();
    sessions.principal = { userId: "user-1" };
    const { app, provider } = createTestApp({ sessions });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/login",
      headers: { cookie: `nwa_session=${OLD_SESSION_TOKEN}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
    expect(provider.authorizationCount).toBe(0);
  });

  it.each([
    `nwa_session=${OLD_SESSION_TOKEN}; nwa_session=${NEW_SESSION_TOKEN}`,
    `nwa_session=${NEW_SESSION_TOKEN}; nwa_session=${OLD_SESSION_TOKEN}`,
  ])(
    "rejects duplicate session cookies regardless of order",
    async (cookie) => {
      const sessions = new FakeSessions();
      sessions.principal = { userId: "user-1" };
      const { app, provider } = createTestApp({ sessions });

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/login",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: "AUTH_COOKIE_AMBIGUOUS" },
      });
      expect(provider.authorizationCount).toBe(0);
    },
  );

  it("validates the attempt and replaces any existing cookie with a fresh session", async () => {
    const { app, provider, sessions } = createTestApp();
    const { attemptCookie } = await startLogin(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=code-fixture&state=state-value",
      headers: {
        cookie: `${attemptCookie}; nwa_session=${OLD_SESSION_TOKEN}`,
      },
    });
    const sessionPair = cookiePair(response, "nwa_session");
    const sessionValue = sessionPair.slice("nwa_session=".length);
    const cookies = redactCookieValues(cookieLines(response));

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(provider.receivedAttempt).toEqual({
      version: 1,
      state: "state-value",
      nonce: "independent-nonce",
      codeVerifier: "pkce-verifier",
      issuedAt: NOW.getTime(),
      expiresAt: NOW.getTime() + 600_000,
    });
    expect(sessions.createdFor).toBe("user-1");
    expect(hashSessionToken(sessionValue)).toBe(
      hashSessionToken(NEW_SESSION_TOKEN),
    );
    expect(hashSessionToken(sessionValue)).not.toBe(
      hashSessionToken(OLD_SESSION_TOKEN),
    );
    expect(cookies).toContainEqual(
      expect.stringMatching(
        /^nwa_session=<redacted>; Max-Age=28800; Path=\/; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
      ),
    );
    expect(cookies).toContainEqual(
      expect.stringMatching(
        /^nwa_oidc_attempt=<redacted>; Max-Age=0; Path=\/api\/auth\/callback; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
      ),
    );
    expect(response.body).not.toContain("code-fixture");
    expect(response.body).not.toContain("pkce-verifier");
  });

  it("rejects state mismatch before provider exchange and cannot replay without the attempt cookie", async () => {
    const { app, provider } = createTestApp();
    const { attemptCookie } = await startLogin(app);

    const mismatch = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=code-fixture&state=wrong-state",
      headers: { cookie: attemptCookie },
    });
    const replay = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=code-fixture&state=state-value",
    });

    expect(mismatch.statusCode).toBe(303);
    expect(mismatch.headers.location).toBe(
      "/?auth_error=authentication_failed",
    );
    expect(replay.statusCode).toBe(303);
    expect(replay.headers.location).toBe("/?auth_error=authentication_failed");
    expect(provider.validationCount).toBe(0);
  });

  it("rejects duplicate attempt cookies before provider validation", async () => {
    const { app, provider } = createTestApp();
    const { attemptCookie } = await startLogin(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=code-fixture&state=state-value",
      headers: { cookie: `${attemptCookie}; ${attemptCookie}` },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      "/?auth_error=authentication_failed",
    );
    expect(provider.validationCount).toBe(0);
  });

  it("fails closed for tampered and expired route-level attempts", async () => {
    const provider = new FakeProvider();
    const expiredState = new OidcTransientStateService(
      new Uint8Array(32).fill(5),
      {
        now: () => new Date(NOW.getTime() + 60_000),
      },
    );
    const sourceState = new OidcTransientStateService(
      new Uint8Array(32).fill(5),
      {
        now: () => NOW,
        durationMs: 60_000,
      },
    );
    const expired = await sourceState.seal({
      state: "state-value",
      nonce: "nonce",
      codeVerifier: "verifier",
    });
    const { app } = createTestApp({ provider, transientState: expiredState });

    for (const cookie of [
      "nwa_oidc_attempt=not-a-jwe",
      `nwa_oidc_attempt=${expired.value}`,
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?code=code-fixture&state=state-value",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(
        "/?auth_error=authentication_failed",
      );
    }
    expect(provider.validationCount).toBe(0);
  });

  it("invalidates the first callback after a second login replaces its attempt", async () => {
    const provider = new FakeProvider();
    const { app } = createTestApp({ provider });
    const first = await startLogin(app);
    provider.state = "second-state";
    const second = await startLogin(app);

    const stale = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=code-fixture&state=state-value",
      headers: { cookie: second.attemptCookie },
    });
    const current = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=code-fixture&state=second-state",
      headers: { cookie: second.attemptCookie },
    });

    expect(first.attemptCookie === second.attemptCookie).toBe(false);
    expect(stale.headers.location).toBe("/?auth_error=authentication_failed");
    expect(current.statusCode).toBe(303);
  });

  it.each([
    [new OidcAccessDeniedError(), "access_denied"],
    [new OidcCallbackValidationError(), "authentication_failed"],
  ] as const)(
    "maps callback failures to safe allowlisted errors",
    async (failure, code) => {
      const provider = new FakeProvider();
      provider.callbackFailure = failure;
      const { app } = createTestApp({ provider });
      const { attemptCookie } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?error=unsafe-provider-detail&state=state-value",
        headers: { cookie: attemptCookie },
      });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(`/?auth_error=${code}`);
      expect(response.headers.location).not.toContain("unsafe-provider-detail");
    },
  );

  it.each([
    ["unknown", null],
    ["disabled", { id: "user-1", disabledAt: NOW }],
  ] as const)(
    "rejects an %s identity without session creation",
    async (_label, user) => {
      const identities = new FakeIdentityRepository();
      identities.user = user;
      const { app, sessions } = createTestApp({ identities });
      const { attemptCookie } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/callback?code=code-fixture&state=state-value",
        headers: { cookie: attemptCookie },
      });

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe("/?auth_error=not_authorized");
      expect(sessions.createdFor).toBeUndefined();
      expect(
        cookieLines(response).some((line) => line.startsWith("nwa_session=")),
      ).toBe(false);
    },
  );

  it("requires an exact Origin before revoking and clearing logout", async () => {
    const { app, sessions } = createTestApp();

    for (const origin of [undefined, "https://attacker.example.test"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: origin ? { origin } : undefined,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: "INVALID_ORIGIN" } });
    }
    expect(sessions.revoked).toBeUndefined();
  });

  it("revokes logout idempotently and clears the application cookie", async () => {
    const { app, sessions } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: "https://assistant.example.test",
        cookie: `nwa_session=${OLD_SESSION_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(hashSessionToken(sessions.revoked!)).toBe(
      hashSessionToken(OLD_SESSION_TOKEN),
    );
    expect(redactCookieValues(cookieLines(response))).toContainEqual(
      expect.stringMatching(
        /^nwa_session=<redacted>; Max-Age=0; Path=\/; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
      ),
    );

    const alreadySignedOut = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { origin: "https://assistant.example.test" },
    });
    expect(alreadySignedOut.statusCode).toBe(204);
  });

  it("rejects duplicate session cookies during logout", async () => {
    const { app, sessions } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: "https://assistant.example.test",
        cookie: `nwa_session=${OLD_SESSION_TOKEN}; nwa_session=${NEW_SESSION_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(sessions.revoked).toBeUndefined();
  });

  it("allows local session logout with an application origin but no OIDC runtime", async () => {
    const sessions = new FakeSessions();
    const app = buildApp({
      sessions,
      sessionCookies: {
        applicationOrigin: new URL("https://assistant.example.test"),
        secureCookies: true,
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: "https://assistant.example.test",
        cookie: `nwa_session=${OLD_SESSION_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(hashSessionToken(sessions.revoked!)).toBe(
      hashSessionToken(OLD_SESSION_TOKEN),
    );
  });

  it("reports unavailable logout configuration without claiming cookie clearing", async () => {
    const app = buildApp({ sessions: new FakeSessions() });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { origin: "https://assistant.example.test" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: "AUTH_CONFIGURATION_UNAVAILABLE" },
    });
  });

  it("clears the browser cookie and returns a safe error when revocation storage fails", async () => {
    const sessions = new FakeSessions();
    sessions.revokeFailure = true;
    const { app } = createTestApp({ sessions });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: "https://assistant.example.test",
        cookie: `nwa_session=${OLD_SESSION_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "AUTH_UNAVAILABLE" } });
    expect(
      cookieLines(response).some((line) => line.startsWith("nwa_session=")),
    ).toBe(true);
  });

  it("keeps health and readiness independent from the OIDC provider", async () => {
    const { app, provider } = createTestApp();

    const health = await app.inject({ method: "GET", url: "/health" });
    const readiness = await app.inject({ method: "GET", url: "/health/ready" });

    expect(health.statusCode).toBe(200);
    expect(readiness.statusCode).toBe(503);
    expect(provider.authorizationCount).toBe(0);
    expect(provider.validationCount).toBe(0);
  });
});
