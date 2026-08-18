import { describe, expect, it } from "vitest";

import {
  OidcConfigurationError,
  parseApplicationSessionConfiguration,
  parseOidcConfiguration,
} from "./oidc-config.js";

const SECRET = Buffer.alloc(32, 7).toString("base64url");

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    APPLICATION_ORIGIN: "https://assistant.example.test",
    OIDC_ISSUER: "https://identity.example.test/tenant",
    OIDC_CLIENT_ID: "client-id",
    OIDC_TRANSIENT_SECRET: SECRET,
    ...overrides,
  };
}

describe("OIDC configuration", () => {
  it("allows OIDC to be fully unconfigured", () => {
    expect(parseOidcConfiguration({})).toBeUndefined();
  });

  it("allows an application origin without enabling OIDC", () => {
    expect(
      parseOidcConfiguration({
        APPLICATION_ORIGIN: "https://assistant.example.test",
      }),
    ).toBeUndefined();
    expect(
      parseApplicationSessionConfiguration({
        APPLICATION_ORIGIN: "https://assistant.example.test",
      }),
    ).toMatchObject({ secureCookies: true });
  });

  it("derives callback and secure-cookie behavior from the application origin", () => {
    const configuration = parseOidcConfiguration(
      validEnvironment({ OIDC_CLIENT_SECRET: "client-secret" }),
    );

    expect(configuration).toMatchObject({
      clientId: "client-id",
      clientSecret: "client-secret",
      issuerIdentifier: "https://identity.example.test/tenant",
      secureCookies: true,
    });
    expect(configuration?.applicationOrigin.href).toBe(
      "https://assistant.example.test/",
    );
    expect(configuration?.callbackUrl.href).toBe(
      "https://assistant.example.test/api/auth/callback",
    );
    expect(configuration?.issuer.href).toBe(
      "https://identity.example.test/tenant",
    );
    expect(configuration?.transientSecret).toHaveLength(32);
  });

  it("accepts an issuer at the persistence boundary and rejects one character more", () => {
    const acceptedIssuer = `https://${"i".repeat(243)}.com`;
    const rejectedIssuer = `https://${"i".repeat(244)}.com`;

    expect(
      parseOidcConfiguration(validEnvironment({ OIDC_ISSUER: acceptedIssuer }))
        ?.issuerIdentifier,
    ).toBe(acceptedIssuer);
    expect(() =>
      parseOidcConfiguration(validEnvironment({ OIDC_ISSUER: rejectedIssuer })),
    ).toThrow(OidcConfigurationError);
  });

  it("allows HTTP only for exact loopback hosts", () => {
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ]) {
      expect(
        parseOidcConfiguration(validEnvironment({ APPLICATION_ORIGIN: origin }))
          ?.secureCookies,
      ).toBe(false);
    }
  });

  it.each([
    ["partial configuration", { OIDC_CLIENT_ID: "client-id" }],
    [
      "origin path",
      validEnvironment({ APPLICATION_ORIGIN: "https://example.test/app" }),
    ],
    [
      "origin query",
      validEnvironment({ APPLICATION_ORIGIN: "https://example.test/?a=b" }),
    ],
    [
      "non-loopback HTTP",
      validEnvironment({ APPLICATION_ORIGIN: "http://example.test" }),
    ],
    [
      "insecure issuer",
      validEnvironment({ OIDC_ISSUER: "http://identity.example.test" }),
    ],
    [
      "issuer query",
      validEnvironment({ OIDC_ISSUER: "https://identity.example.test?a=b" }),
    ],
    [
      "short transient secret",
      validEnvironment({ OIDC_TRANSIENT_SECRET: "short" }),
    ],
    ["blank client secret", validEnvironment({ OIDC_CLIENT_SECRET: " " })],
    [
      "oversized issuer",
      validEnvironment({ OIDC_ISSUER: `https://${"i".repeat(245)}.test` }),
    ],
  ])("rejects %s", (_label, environment) => {
    expect(() => parseOidcConfiguration(environment)).toThrow(
      OidcConfigurationError,
    );
  });

  it("does not include configured values in validation errors", () => {
    const unsafeValue = "do-not-expose-this-value";

    try {
      parseOidcConfiguration(
        validEnvironment({ OIDC_TRANSIENT_SECRET: unsafeValue }),
      );
      throw new Error("Expected configuration validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(OidcConfigurationError);
      expect(String(error)).not.toContain(unsafeValue);
    }
  });
});
