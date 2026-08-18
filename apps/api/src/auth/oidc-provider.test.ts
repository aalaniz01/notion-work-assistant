import {
  exportJWK,
  CompactSign,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import * as openid from "openid-client";
import { describe, expect, it } from "vitest";

import { parseOidcConfiguration } from "./oidc-config.js";
import {
  OidcAccessDeniedError,
  OidcCallbackValidationError,
  OidcProviderUnavailableError,
  OpenIdClientProvider,
} from "./oidc-provider.js";

const ISSUER = "https://identity.example.test";
const CLIENT_ID = "client-id";
const NOW_SECONDS = Math.floor(Date.now() / 1000);

interface ProviderFixtureOptions {
  audience?: string;
  clientSecret?: string;
  claims?: Record<string, unknown>;
  configuredIssuer?: string;
  discoveryFailure?: unknown;
  expiresAt?: number;
  issuer?: string;
  pkceMethods?: ReadonlyArray<string> | null;
  rawPayload?: (nonce: string) => string;
  tokenAuthenticationMethods?: ReadonlyArray<string> | undefined;
  tokenResponse?: Response;
  jwksResponse?: Response;
  jwksFailure?: unknown;
  tokenFailure?: unknown;
  transientDiscoveryFailures?: number;
  nonce?: string;
  signWithDifferentKey?: boolean;
  discoveryIssuer?: string;
}

async function providerFixture(options: ProviderFixtureOptions = {}) {
  const signing = await generateKeyPair("RS256");
  const otherSigning = await generateKeyPair("RS256");
  const publicJwk: JWK = await exportJWK(signing.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "test-key";
  publicJwk.use = "sig";
  let expectedNonce = "";
  let expectedVerifier = "";
  let verifierMatched = false;
  let clientSecretMatched = false;
  let discoveryCount = 0;

  async function createIdToken(privateKey: CryptoKey): Promise<string> {
    if (options.rawPayload) {
      return new CompactSign(
        new TextEncoder().encode(options.rawPayload(expectedNonce)),
      )
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .sign(privateKey);
    }
    return new SignJWT({
      nonce: options.nonce ?? expectedNonce,
      iss: options.issuer ?? ISSUER,
      sub: "subject-1",
      aud: options.audience ?? CLIENT_ID,
      iat: NOW_SECONDS,
      exp: options.expiresAt ?? NOW_SECONDS + 300,
      ...options.claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(privateKey);
  }

  const customFetch: openid.CustomFetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/.well-known/openid-configuration") {
      discoveryCount += 1;
      if (options.discoveryFailure) throw options.discoveryFailure;
      if (discoveryCount <= (options.transientDiscoveryFailures ?? 0)) {
        throw new TypeError("provider unavailable");
      }
      return Response.json({
        issuer: options.discoveryIssuer ?? ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        ...(options.tokenAuthenticationMethods === undefined
          ? {
              token_endpoint_auth_methods_supported: [
                "none",
                "client_secret_post",
              ],
            }
          : {
              token_endpoint_auth_methods_supported:
                options.tokenAuthenticationMethods,
            }),
        ...(options.pkceMethods === undefined
          ? { code_challenge_methods_supported: ["S256"] }
          : options.pkceMethods === null
            ? {}
            : { code_challenge_methods_supported: options.pkceMethods }),
      });
    }
    if (url.pathname === "/token") {
      if (options.tokenFailure) throw options.tokenFailure;
      if (options.tokenResponse) return options.tokenResponse;
      const body = new URLSearchParams(String(init?.body ?? ""));
      verifierMatched = body.get("code_verifier") === expectedVerifier;
      clientSecretMatched = options.clientSecret
        ? body.get("client_secret") === options.clientSecret
        : !body.has("client_secret");
      const privateKey = options.signWithDifferentKey
        ? otherSigning.privateKey
        : signing.privateKey;
      return Response.json({
        access_token: "provider-access-token-fixture",
        token_type: "Bearer",
        id_token: await createIdToken(privateKey),
      });
    }
    if (url.pathname === "/jwks") {
      if (options.jwksFailure) throw options.jwksFailure;
      if (options.jwksResponse) return options.jwksResponse;
      return Response.json({ keys: [publicJwk] });
    }
    return new Response(null, { status: 404 });
  };

  const configuration = parseOidcConfiguration({
    APPLICATION_ORIGIN: "https://assistant.example.test",
    OIDC_ISSUER: options.configuredIssuer ?? ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    ...(options.clientSecret
      ? { OIDC_CLIENT_SECRET: options.clientSecret }
      : {}),
    OIDC_TRANSIENT_SECRET: Buffer.alloc(32, 4).toString("base64url"),
  })!;
  const provider = new OpenIdClientProvider(configuration, { customFetch });

  return {
    provider,
    setAttempt(attempt: { nonce: string; codeVerifier: string }) {
      expectedNonce = attempt.nonce;
      expectedVerifier = attempt.codeVerifier;
    },
    verifierMatched: () => verifierMatched,
    clientSecretMatched: () => clientSecretMatched,
    discoveryCount: () => discoveryCount,
  };
}

describe("OpenID Connect provider", () => {
  it("builds a cached Authorization Code request with independent state, nonce, and PKCE", async () => {
    const fixture = await providerFixture();

    const first = await fixture.provider.createAuthorizationRequest();
    const second = await fixture.provider.createAuthorizationRequest();
    const expectedChallenge = await openid.calculatePKCECodeChallenge(
      first.codeVerifier,
    );

    expect(first.state === first.nonce).toBe(false);
    expect(first.state === first.codeVerifier).toBe(false);
    expect(first.nonce === first.codeVerifier).toBe(false);
    expect(second.state === first.state).toBe(false);
    expect(second.nonce === first.nonce).toBe(false);
    expect(second.codeVerifier === first.codeVerifier).toBe(false);
    expect(first.url.origin).toBe(ISSUER);
    expect(first.url.pathname).toBe("/authorize");
    expect(first.url.searchParams.get("response_type")).toBe("code");
    expect(first.url.searchParams.get("scope")).toBe("openid");
    expect(first.url.searchParams.get("state")).toBe(first.state);
    expect(first.url.searchParams.get("nonce")).toBe(first.nonce);
    expect(first.url.searchParams.get("code_challenge")).toBe(
      expectedChallenge,
    );
    expect(first.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.url.searchParams.get("redirect_uri")).toBe(
      "https://assistant.example.test/api/auth/callback",
    );
    expect(fixture.discoveryCount()).toBe(1);
  });

  it("exchanges a code with PKCE and returns only validated issuer and subject", async () => {
    const fixture = await providerFixture();
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).resolves.toEqual({ issuer: ISSUER, subject: "subject-1" });
    expect(fixture.verifierMatched()).toBe(true);
    expect(fixture.clientSecretMatched()).toBe(true);
    expect(fixture.discoveryCount()).toBe(1);
  });

  it("uses standard client-secret authentication only when configured", async () => {
    const fixture = await providerFixture({ clientSecret: "client-secret" });
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await fixture.provider.validateCallback(callback, attempt);
    expect(fixture.clientSecretMatched()).toBe(true);
  });

  it.each([
    ["missing PKCE metadata", null],
    ["unsupported PKCE metadata", ["plain"]],
  ])("rejects %s", async (_label, pkceMethods) => {
    const fixture = await providerFixture({ pkceMethods });

    await expect(
      fixture.provider.createAuthorizationRequest(),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it.each([
    [
      "confidential",
      { clientSecret: "client-secret", tokenAuthenticationMethods: ["none"] },
    ],
    ["public", { tokenAuthenticationMethods: ["client_secret_post"] }],
  ] as const)(
    "rejects unsupported %s client authentication",
    async (_label, options) => {
      const fixture = await providerFixture(options);

      await expect(
        fixture.provider.createAuthorizationRequest(),
      ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
    },
  );

  it.each([
    ["signature", { signWithDifferentKey: true }],
    ["issuer", { issuer: "https://attacker.example.test" }],
    ["audience", { audience: "other-client" }],
    ["expiration", { expiresAt: NOW_SECONDS - 120 }],
    ["nonce", { nonce: "wrong-nonce" }],
  ] as const)("rejects an invalid ID-token %s", async (_label, options) => {
    const fixture = await providerFixture(options);
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcCallbackValidationError);
  });

  it.each([
    ["missing subject", { claims: { sub: undefined } }],
    ["missing issuer", { claims: { iss: undefined } }],
    ["non-string subject", { claims: { sub: 1 } }],
    ["blank subject", { claims: { sub: " " } }],
    ["oversized subject", { claims: { sub: "s".repeat(256) } }],
    ["non-string issuer", { claims: { iss: 1 } }],
    [
      "oversized issuer",
      { claims: { iss: `https://${"i".repeat(245)}.test` } },
    ],
    ["malformed audience", { claims: { aud: [CLIENT_ID, 1] } }],
  ])("rejects a signed token with %s", async (_label, options) => {
    const fixture = await providerFixture(options);
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcCallbackValidationError);
  });

  it.each([
    [
      "non-finite expiration",
      (nonce: string) =>
        `{"iss":"${ISSUER}","sub":"subject-1","aud":"${CLIENT_ID}","iat":${NOW_SECONDS},"exp":1e400,"nonce":"${nonce}"}`,
    ],
    [
      "non-finite issued at",
      (nonce: string) =>
        `{"iss":"${ISSUER}","sub":"subject-1","aud":"${CLIENT_ID}","iat":1e400,"exp":${NOW_SECONDS + 300},"nonce":"${nonce}"}`,
    ],
  ])("rejects a signed token with %s", async (_label, rawPayload) => {
    const fixture = await providerFixture({ rawPayload });
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcCallbackValidationError);
  });

  it("rejects discovery metadata with a different issuer", async () => {
    const fixture = await providerFixture({
      discoveryIssuer: "https://attacker.example.test",
    });

    await expect(
      fixture.provider.createAuthorizationRequest(),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it("requires the discovered issuer to exactly match its configured spelling", async () => {
    const fixture = await providerFixture({
      configuredIssuer: "https://IDENTITY.example.test",
    });

    await expect(
      fixture.provider.createAuthorizationRequest(),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it("rejects provider access denial without exchanging a code", async () => {
    const fixture = await providerFixture();
    const attempt = await fixture.provider.createAuthorizationRequest();
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?error=access_denied&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcAccessDeniedError);
    expect(fixture.verifierMatched()).toBe(false);
  });

  it("rejects a malformed callback", async () => {
    const fixture = await providerFixture();
    const attempt = await fixture.provider.createAuthorizationRequest();
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcCallbackValidationError);
  });

  it("coalesces concurrent discovery and retries after a failure", async () => {
    const fixture = await providerFixture({ transientDiscoveryFailures: 1 });

    await expect(
      Promise.all([
        fixture.provider.createAuthorizationRequest(),
        fixture.provider.createAuthorizationRequest(),
      ]),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
    expect(fixture.discoveryCount()).toBe(1);

    await expect(
      fixture.provider.createAuthorizationRequest(),
    ).resolves.toMatchObject({ state: expect.any(String) });
    expect(fixture.discoveryCount()).toBe(2);
  });

  it.each([
    ["token endpoint server failure", new Response(null, { status: 503 })],
    [
      "token endpoint malformed outage",
      new Response("not json", { status: 200 }),
    ],
  ])("maps %s to provider unavailability", async (_label, tokenResponse) => {
    const fixture = await providerFixture({ tokenResponse });
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it("maps JWKS server failure to provider unavailability", async () => {
    const fixture = await providerFixture({
      jwksResponse: new Response(null, { status: 503 }),
    });
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it("maps discovery network failure to provider unavailability", async () => {
    const fixture = await providerFixture({
      discoveryFailure: new TypeError("network"),
    });

    await expect(
      fixture.provider.createAuthorizationRequest(),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });

  it.each([
    [
      "token endpoint timeout",
      { tokenFailure: new DOMException("timeout", "TimeoutError") },
    ],
    ["JWKS network failure", { jwksFailure: new TypeError("network") }],
  ] as const)("maps %s to provider unavailability", async (_label, options) => {
    const fixture = await providerFixture(options);
    const attempt = await fixture.provider.createAuthorizationRequest();
    fixture.setAttempt(attempt);
    const callback = new URL(
      `https://assistant.example.test/api/auth/callback?code=code-fixture&state=${attempt.state}`,
    );

    await expect(
      fixture.provider.validateCallback(callback, attempt),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
  });
});
