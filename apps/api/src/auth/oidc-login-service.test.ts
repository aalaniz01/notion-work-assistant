import type {
  ExternalIdentityRepository,
  ExternalIdentityUserRecord,
} from "@notion-work-assistant/db";
import { describe, expect, it } from "vitest";

import { AuthenticationUnavailableError } from "./errors.js";
import {
  OidcIdentityNotAuthorizedError,
  OidcLoginService,
} from "./oidc-login-service.js";
import type { OidcProvider } from "./oidc-provider.js";
import {
  hashSessionToken,
  type CreatedSession,
  type SessionService,
} from "./session-service.js";

const IDENTITY = {
  issuer: "https://identity.example.test",
  subject: "subject-1",
};

const unusedProvider: OidcProvider = {
  createAuthorizationRequest: async () => {
    throw new Error("Not used");
  },
  validateCallback: async () => {
    throw new Error("Not used");
  },
};

class FakeIdentityRepository implements ExternalIdentityRepository {
  user: ExternalIdentityUserRecord | null = {
    id: "user-1",
    disabledAt: null,
  };
  failure: unknown;
  received: typeof IDENTITY | undefined;

  async findUserByIdentity(issuer: string, subject: string) {
    this.received = { issuer, subject };
    if (this.failure) throw this.failure;
    return this.user;
  }
}

class FakeSessionService implements SessionService {
  createdFor: string | undefined;

  async create(userId: string): Promise<CreatedSession> {
    this.createdFor = userId;
    return {
      token: "s".repeat(43),
      expiresAt: new Date("2026-01-01T08:00:00.000Z"),
    };
  }

  async authenticate() {
    return null;
  }

  async revoke() {}
}

describe("OIDC identity login", () => {
  it("uses exact issuer and subject before creating an application session", async () => {
    const identities = new FakeIdentityRepository();
    const sessions = new FakeSessionService();
    const service = new OidcLoginService(unusedProvider, identities, sessions);

    const created = await service.createSessionForIdentity(IDENTITY);

    expect(hashSessionToken(created.token)).toBe(
      hashSessionToken("s".repeat(43)),
    );
    expect(created.expiresAt).toEqual(new Date("2026-01-01T08:00:00.000Z"));
    expect(identities.received).toEqual(IDENTITY);
    expect(sessions.createdFor).toBe("user-1");
  });

  it.each([
    ["unknown", null],
    ["disabled", { id: "user-1", disabledAt: new Date() }],
  ] as const)(
    "rejects an %s identity without creating a session",
    async (_label, user) => {
      const identities = new FakeIdentityRepository();
      identities.user = user;
      const sessions = new FakeSessionService();
      const service = new OidcLoginService(
        unusedProvider,
        identities,
        sessions,
      );

      await expect(
        service.createSessionForIdentity(IDENTITY),
      ).rejects.toBeInstanceOf(OidcIdentityNotAuthorizedError);
      expect(sessions.createdFor).toBeUndefined();
    },
  );

  it("maps identity storage failures to a safe error", async () => {
    const identities = new FakeIdentityRepository();
    identities.failure = new Error("unsafe database details");
    const service = new OidcLoginService(
      unusedProvider,
      identities,
      new FakeSessionService(),
    );

    const operation = service.createSessionForIdentity(IDENTITY);
    await expect(operation).rejects.toBeInstanceOf(
      AuthenticationUnavailableError,
    );
    await expect(operation).rejects.toHaveProperty(
      "message",
      "Authentication storage is unavailable",
    );
  });
});
