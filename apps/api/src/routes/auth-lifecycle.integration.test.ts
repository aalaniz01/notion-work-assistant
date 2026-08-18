import type {
  ExternalIdentityRepository,
  SessionAuthenticationRecord,
  SessionRepository,
  UserAuthenticationRecord,
} from "@notion-work-assistant/db";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { FastifyInstance } from "fastify";
import * as openid from "openid-client";
import { afterEach, describe, expect, it } from "vitest";

import { parseOidcConfiguration } from "../auth/oidc-config.js";
import { OidcLoginService } from "../auth/oidc-login-service.js";
import { OpenIdClientProvider } from "../auth/oidc-provider.js";
import { OidcTransientStateService } from "../auth/oidc-transient-state.js";
import {
  ApplicationSessionService,
  hashSessionToken,
} from "../auth/session-service.js";
import { buildApp } from "../app.js";

const ISSUER = "https://identity.example.test";
const CLIENT_ID = "client-id";
const RAW_SESSION_TOKEN = "s".repeat(43);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const apps: FastifyInstance[] = [];

class ExactIdentityRepository implements ExternalIdentityRepository {
  private readonly identities = new Map<string, UserAuthenticationRecord>();

  add(issuer: string, subject: string, user: UserAuthenticationRecord): void {
    this.identities.set(`${issuer}\u0000${subject}`, user);
  }

  async findUserByIdentity(issuer: string, subject: string) {
    return this.identities.get(`${issuer}\u0000${subject}`) ?? null;
  }
}

class HashOnlySessionRepository implements SessionRepository {
  readonly users = new Map<string, UserAuthenticationRecord>();
  readonly records = new Map<string, SessionAuthenticationRecord>();

  async findUserById(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async create(session: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    this.records.set(session.tokenHash, {
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: null,
      disabledAt: null,
    });
  }

  async findByTokenHash(tokenHash: string) {
    return this.records.get(tokenHash) ?? null;
  }

  async revoke(tokenHash: string) {
    const session = this.records.get(tokenHash);
    if (session) session.revokedAt = NOW;
  }
}

function cookiePair(
  response: {
    headers: Record<string, string | string[] | number | undefined>;
  },
  name: string,
): string {
  const values = response.headers["set-cookie"];
  const lines = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];
  const line = lines.find((value) => value.startsWith(`${name}=`));
  if (!line) throw new Error(`Expected ${name} cookie`);
  return line.split(";", 1)[0]!;
}

describe("OIDC production callback path", () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("validates a signed provider identity and creates only a hashed application session", async () => {
    const signing = await generateKeyPair("RS256");
    const publicJwk: JWK = await exportJWK(signing.publicKey);
    publicJwk.alg = "RS256";
    publicJwk.kid = "integration-key";
    publicJwk.use = "sig";
    let expectedNonce = "";

    const customFetch: openid.CustomFetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.pathname === "/token") {
        const idToken = await new SignJWT({ nonce: expectedNonce })
          .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
          .setIssuer(ISSUER)
          .setSubject("subject-1")
          .setAudience(CLIENT_ID)
          .setIssuedAt(Math.floor(Date.now() / 1_000))
          .setExpirationTime(Math.floor(Date.now() / 1_000) + 300)
          .sign(signing.privateKey);
        return Response.json({
          access_token: "provider-token-fixture",
          token_type: "Bearer",
          id_token: idToken,
        });
      }
      if (url.pathname === "/jwks") return Response.json({ keys: [publicJwk] });
      return new Response(null, { status: 404 });
    };

    const configuration = parseOidcConfiguration({
      APPLICATION_ORIGIN: "https://assistant.example.test",
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_TRANSIENT_SECRET: Buffer.alloc(32, 8).toString("base64url"),
    })!;
    const identities = new ExactIdentityRepository();
    const sessions = new HashOnlySessionRepository();
    const user = { id: "user-1", disabledAt: null };
    identities.add(ISSUER, "subject-1", user);
    sessions.users.set(user.id, user);
    const sessionService = new ApplicationSessionService(sessions, {
      generateToken: () => RAW_SESSION_TOKEN,
      now: () => NOW,
    });
    const app = buildApp({
      oidc: {
        applicationOrigin: configuration.applicationOrigin,
        callbackUrl: configuration.callbackUrl,
        login: new OidcLoginService(
          new OpenIdClientProvider(configuration, { customFetch }),
          identities,
          sessionService,
        ),
        now: () => NOW,
        secureCookies: true,
        transientState: new OidcTransientStateService(
          configuration.transientSecret,
          { now: () => NOW },
        ),
      },
      sessions: sessionService,
    });
    apps.push(app);

    const login = await app.inject({ method: "GET", url: "/api/auth/login" });
    const authorization = new URL(login.headers.location!);
    expectedNonce = authorization.searchParams.get("nonce")!;
    const attemptCookie = cookiePair(login, "nwa_oidc_attempt");
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/callback?code=code-fixture&state=${authorization.searchParams.get("state")!}`,
      headers: { cookie: attemptCookie },
    });
    const sessionCookie = cookiePair(callback, "nwa_session");
    const rawToken = sessionCookie.slice("nwa_session=".length);

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe("/");
    expect(hashSessionToken(rawToken)).toBe(
      hashSessionToken(RAW_SESSION_TOKEN),
    );
    expect(sessions.records.has(hashSessionToken(RAW_SESSION_TOKEN))).toBe(
      true,
    );
    expect(JSON.stringify([...sessions.records.entries()])).not.toContain(
      RAW_SESSION_TOKEN,
    );
    expect(login.body).not.toContain("provider-token-fixture");
    expect(callback.body).not.toContain("provider-token-fixture");
    expect(callback.body).not.toContain(RAW_SESSION_TOKEN);
  });
});
