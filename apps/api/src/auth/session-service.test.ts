import type {
  NewSessionRecord,
  SessionAuthenticationRecord,
  SessionRepository,
  UserAuthenticationRecord,
} from "@notion-work-assistant/db";
import { describe, expect, it } from "vitest";

import {
  AuthenticationUnavailableError,
  SessionCreationError,
} from "./errors.js";
import {
  ApplicationSessionService,
  hashSessionToken,
} from "./session-service.js";

const TOKEN = "a".repeat(43);
const NOW = new Date("2026-01-01T00:00:00.000Z");

class FakeSessionRepository implements SessionRepository {
  user: UserAuthenticationRecord | null = { id: "user-1", disabledAt: null };
  session: SessionAuthenticationRecord | null = null;
  created: NewSessionRecord | undefined;
  revoked: { tokenHash: string; revokedAt: Date } | undefined;
  failure: unknown;

  async findUserById(): Promise<UserAuthenticationRecord | null> {
    if (this.failure) throw this.failure;
    return this.user;
  }

  async create(session: NewSessionRecord): Promise<void> {
    if (this.failure) throw this.failure;
    this.created = session;
  }

  async findByTokenHash(): Promise<SessionAuthenticationRecord | null> {
    if (this.failure) throw this.failure;
    return this.session;
  }

  async revoke(tokenHash: string, revokedAt: Date): Promise<void> {
    if (this.failure) throw this.failure;
    this.revoked = { tokenHash, revokedAt };
  }
}

function service(repository: FakeSessionRepository) {
  return new ApplicationSessionService(repository, {
    now: () => NOW,
    generateToken: () => TOKEN,
  });
}

describe("ApplicationSessionService", () => {
  it("generates unique 256-bit base64url session tokens by default", async () => {
    const firstRepository = new FakeSessionRepository();
    const secondRepository = new FakeSessionRepository();
    const first = await new ApplicationSessionService(firstRepository, {
      now: () => NOW,
    }).create("user-1");
    const second = await new ApplicationSessionService(secondRepository, {
      now: () => NOW,
    }).create("user-1");

    expect(/^[A-Za-z0-9_-]{43}$/.test(first.token)).toBe(true);
    expect(/^[A-Za-z0-9_-]{43}$/.test(second.token)).toBe(true);
    expect(hashSessionToken(first.token)).not.toBe(
      hashSessionToken(second.token),
    );
    expect(firstRepository.created?.tokenHash).toHaveLength(64);
    expect(firstRepository.created?.tokenHash).toBe(
      hashSessionToken(first.token),
    );
  });

  it("creates an opaque session and persists only its SHA-256 hash", async () => {
    const repository = new FakeSessionRepository();

    const created = await service(repository).create("user-1");

    expect(hashSessionToken(created.token)).toBe(hashSessionToken(TOKEN));
    expect(created.expiresAt).toEqual(new Date("2026-01-01T08:00:00.000Z"));
    expect(repository.created).toEqual({
      userId: "user-1",
      tokenHash: hashSessionToken(TOKEN),
      createdAt: NOW,
      expiresAt: new Date("2026-01-01T08:00:00.000Z"),
    });
    expect(JSON.stringify(repository.created).includes(TOKEN)).toBe(false);
  });

  it.each([
    null,
    { id: "user-1", disabledAt: NOW },
  ] as Array<UserAuthenticationRecord | null>)(
    "does not create a session for unavailable user %#",
    async (user) => {
      const repository = new FakeSessionRepository();
      repository.user = user;
      await expect(service(repository).create("user-1")).rejects.toBeInstanceOf(
        SessionCreationError,
      );
    },
  );

  it("authenticates a valid session", async () => {
    const repository = new FakeSessionRepository();
    repository.session = {
      userId: "user-1",
      expiresAt: new Date("2026-01-01T00:00:01.000Z"),
      revokedAt: null,
      disabledAt: null,
    };

    await expect(service(repository).authenticate(TOKEN)).resolves.toEqual({
      userId: "user-1",
    });
  });

  it.each([undefined, "malformed"])(
    "treats token %s as anonymous",
    async (token) => {
      await expect(
        service(new FakeSessionRepository()).authenticate(token),
      ).resolves.toBeNull();
    },
  );

  it.each([
    null,
    {
      userId: "user-1",
      expiresAt: NOW,
      revokedAt: null,
      disabledAt: null,
    },
    {
      userId: "user-1",
      expiresAt: new Date("2026-01-01T00:00:01.000Z"),
      revokedAt: NOW,
      disabledAt: null,
    },
    {
      userId: "user-1",
      expiresAt: new Date("2026-01-01T00:00:01.000Z"),
      revokedAt: null,
      disabledAt: NOW,
    },
  ] as Array<SessionAuthenticationRecord | null>)(
    "rejects inactive session %#",
    async (sessionRecord) => {
      const repository = new FakeSessionRepository();
      repository.session = sessionRecord;
      await expect(service(repository).authenticate(TOKEN)).resolves.toBeNull();
    },
  );

  it("revokes only a hashed token", async () => {
    const repository = new FakeSessionRepository();
    await service(repository).revoke(TOKEN);
    expect(repository.revoked).toEqual({
      tokenHash: hashSessionToken(TOKEN),
      revokedAt: NOW,
    });
  });

  it("maps repository errors without exposing their message", async () => {
    const repository = new FakeSessionRepository();
    repository.failure = new Error("unsafe database URL");
    const operation = service(repository).authenticate(TOKEN);
    await expect(operation).rejects.toBeInstanceOf(
      AuthenticationUnavailableError,
    );
    await expect(operation).rejects.toHaveProperty(
      "message",
      "Authentication storage is unavailable",
    );
  });
});
