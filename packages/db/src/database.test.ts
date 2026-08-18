import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "./client.js";
import { DrizzleExternalIdentityRepository } from "./external-identity-repository.js";
import { DrizzleIdentityProvisioningRepository } from "./identity-provisioning-repository.js";
import { DrizzlePrioritySettingsRepository } from "./priority-settings-repository.js";
import { createDatabaseReadinessCheck } from "./readiness.js";
import {
  externalIdentities,
  prioritySettings,
  sessions,
  users,
  workspaceMemberships,
  workspaces,
} from "./schema.js";
import { DrizzleSessionRepository } from "./session-repository.js";
import { requireTestDatabaseUrl } from "./test-database-safety.js";
import { DrizzleWorkspaceMembershipRepository } from "./workspace-membership-repository.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
let database: Database | undefined;
let testDatabaseUrl: string;

function getDatabase(): Database {
  if (!database) throw new Error("Test database is not initialized");
  return database;
}

beforeAll(async () => {
  // Validate before creating a client or performing any database operation.
  testDatabaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  database = createDatabase(testDatabaseUrl, { max: 1 });
  await migrate(database.db, { migrationsFolder });
});

beforeEach(async () => {
  // Revalidate immediately before the only destructive test operation.
  requireTestDatabaseUrl(testDatabaseUrl);
  await getDatabase().db.execute(
    sql`truncate table ${sessions}, ${externalIdentities}, ${workspaceMemberships}, ${prioritySettings}, ${users}, ${workspaces}`,
  );
});

afterAll(async () => {
  await database?.close();
});

async function createWorkspace(): Promise<string> {
  const workspaceId = randomUUID();
  await getDatabase().db.insert(workspaces).values({
    id: workspaceId,
    name: "Integration Test Workspace",
  });
  return workspaceId;
}

async function createUser(disabledAt: Date | null = null): Promise<string> {
  const userId = randomUUID();
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  await getDatabase().db.insert(users).values({
    id: userId,
    disabledAt,
    createdAt,
    updatedAt: createdAt,
  });
  return userId;
}

describe("database foundation", () => {
  it("connects to PostgreSQL", async () => {
    const configuredDatabase = getDatabase();

    expect(configuredDatabase.client.options.connect_timeout).toBe(2);
    expect(configuredDatabase.client.options.connection.statement_timeout).toBe(
      2_000,
    );
    expect(await createDatabaseReadinessCheck(configuredDatabase)()).toBe(true);
  });

  it("bounds and shares a stalled readiness probe without closing the database", async () => {
    let queryCount = 0;
    let closeCount = 0;
    const query = Object.assign(new Promise(() => undefined), {
      execute() {
        return this;
      },
    });
    const stalledDatabase = {
      client: (() => {
        queryCount += 1;
        return query;
      }) as unknown as Sql,
      close: async () => {
        closeCount += 1;
      },
    } as unknown as Database;
    const check = createDatabaseReadinessCheck(stalledDatabase, 10);
    const startedAt = Date.now();

    expect(await check()).toBe(false);
    expect(await check()).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(queryCount).toBe(1);
    expect(closeCount).toBe(0);
  });

  it("shares a single database probe across concurrent readiness checks", async () => {
    let queryCount = 0;
    let finishProbe: () => void = () => undefined;
    const probe = Object.assign(
      new Promise<void>((resolve) => {
        finishProbe = resolve;
      }),
      {
        execute() {
          return this;
        },
      },
    );
    const sharedDatabase = {
      client: (() => {
        queryCount += 1;
        return probe;
      }) as unknown as Sql,
    } as unknown as Database;
    const check = createDatabaseReadinessCheck(sharedDatabase);

    const first = check();
    const second = check();

    expect(queryCount).toBe(1);
    finishProbe();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("uses the same database client for sequential readiness probes", async () => {
    let queryCount = 0;
    let closeCount = 0;
    const sharedDatabase = {
      client: (() => {
        queryCount += 1;
        return Object.assign(Promise.resolve(), {
          execute() {
            return this;
          },
        });
      }) as unknown as Sql,
      close: async () => {
        closeCount += 1;
      },
    } as unknown as Database;
    const check = createDatabaseReadinessCheck(sharedDatabase);

    await expect(check()).resolves.toBe(true);
    await expect(check()).resolves.toBe(true);

    expect(queryCount).toBe(2);
    expect(closeCount).toBe(0);
  });

  it("stores and reads default priority settings", async () => {
    const workspaceId = await createWorkspace();
    await getDatabase().db.insert(prioritySettings).values({ workspaceId });

    const repository = new DrizzlePrioritySettingsRepository(getDatabase());
    const settings = await repository.findByWorkspaceId(workspaceId);

    expect(settings).toMatchObject({
      workspaceId,
      deadlineWeight: 50,
      waitingTimeWeight: 40,
      estimatedEffortWeight: 10,
    });
  });

  it("returns null when settings do not exist", async () => {
    const repository = new DrizzlePrioritySettingsRepository(getDatabase());

    await expect(
      repository.findByWorkspaceId(randomUUID()),
    ).resolves.toBeNull();
  });

  it("rejects weights that do not total 100", async () => {
    const workspaceId = await createWorkspace();

    await expect(
      getDatabase().db.insert(prioritySettings).values({
        workspaceId,
        deadlineWeight: 50,
        waitingTimeWeight: 40,
        estimatedEffortWeight: 11,
      }),
    ).rejects.toThrow();
  });

  it.each([
    { deadlineWeight: -1, waitingTimeWeight: 91, estimatedEffortWeight: 10 },
    { deadlineWeight: 101, waitingTimeWeight: 0, estimatedEffortWeight: -1 },
  ])("rejects out-of-range weights %#", async (weights) => {
    const workspaceId = await createWorkspace();

    await expect(
      getDatabase()
        .db.insert(prioritySettings)
        .values({ workspaceId, ...weights }),
    ).rejects.toThrow();
  });

  it("requires an existing workspace", async () => {
    await expect(
      getDatabase()
        .db.insert(prioritySettings)
        .values({ workspaceId: randomUUID() }),
    ).rejects.toThrow();
  });

  it("rejects invalid updates", async () => {
    const workspaceId = await createWorkspace();
    await getDatabase().db.insert(prioritySettings).values({ workspaceId });

    await expect(
      getDatabase()
        .db.update(prioritySettings)
        .set({ deadlineWeight: 60 })
        .where(sql`${prioritySettings.workspaceId} = ${workspaceId}`),
    ).rejects.toThrow();
  });

  it("stores only a unique valid session token hash", async () => {
    const userId = await createUser();
    const repository = new DrizzleSessionRepository(getDatabase());
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const tokenHash = "a".repeat(64);
    await repository.create({
      userId,
      tokenHash,
      createdAt,
      expiresAt: new Date("2026-01-01T08:00:00.000Z"),
    });

    await expect(repository.findByTokenHash(tokenHash)).resolves.toMatchObject({
      userId,
      disabledAt: null,
      revokedAt: null,
    });
    await expect(
      repository.create({
        userId,
        tokenHash,
        createdAt,
        expiresAt: new Date("2026-01-01T09:00:00.000Z"),
      }),
    ).rejects.toThrow();
    await expect(
      repository.create({
        userId,
        tokenHash: "raw-session-token",
        createdAt,
        expiresAt: new Date("2026-01-01T09:00:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("revokes sessions and exposes disabled user state", async () => {
    const disabledAt = new Date("2026-01-01T01:00:00.000Z");
    const userId = await createUser(disabledAt);
    const repository = new DrizzleSessionRepository(getDatabase());
    const tokenHash = "b".repeat(64);
    await repository.create({
      userId,
      tokenHash,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-01T08:00:00.000Z"),
    });
    const revokedAt = new Date("2026-01-01T02:00:00.000Z");
    await repository.revoke(tokenHash, revokedAt);

    await expect(repository.findByTokenHash(tokenHash)).resolves.toMatchObject({
      userId,
      disabledAt,
      revokedAt,
    });
  });

  it("enforces session expiration timestamps", async () => {
    const repository = new DrizzleSessionRepository(getDatabase());
    const createdAt = new Date("2026-01-01T08:00:00.000Z");
    const userId = await createUser();
    await expect(
      repository.create({
        userId,
        tokenHash: "c".repeat(64),
        createdAt,
        expiresAt: createdAt,
      }),
    ).rejects.toThrow();
  });

  it("requires an existing user for sessions", async () => {
    const repository = new DrizzleSessionRepository(getDatabase());
    await expect(
      repository.create({
        userId: randomUUID(),
        tokenHash: "c".repeat(64),
        createdAt: new Date("2026-01-01T08:00:00.000Z"),
        expiresAt: new Date("2026-01-01T09:00:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("lists and checks only active workspace memberships", async () => {
    const userId = await createUser();
    const activeWorkspaceId = await createWorkspace();
    const revokedWorkspaceId = await createWorkspace();
    await getDatabase()
      .db.insert(workspaceMemberships)
      .values([
        { userId, workspaceId: activeWorkspaceId },
        {
          userId,
          workspaceId: revokedWorkspaceId,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          revokedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ]);
    const repository = new DrizzleWorkspaceMembershipRepository(getDatabase());

    await expect(repository.listActiveForUser(userId)).resolves.toEqual([
      { id: activeWorkspaceId, name: "Integration Test Workspace" },
    ]);
    await expect(
      repository.hasActiveMembership(userId, activeWorkspaceId),
    ).resolves.toBe(true);
    await expect(
      repository.hasActiveMembership(userId, revokedWorkspaceId),
    ).resolves.toBe(false);
  });

  it("rejects duplicate memberships and invalid membership timestamps", async () => {
    const userId = await createUser();
    const workspaceId = await createWorkspace();
    await getDatabase().db.insert(workspaceMemberships).values({
      userId,
      workspaceId,
    });

    await expect(
      getDatabase().db.insert(workspaceMemberships).values({
        userId,
        workspaceId,
      }),
    ).rejects.toThrow();
    await expect(
      getDatabase()
        .db.insert(workspaceMemberships)
        .values({
          userId,
          workspaceId: await createWorkspace(),
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          revokedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
    ).rejects.toThrow();
  });

  it("finds a user by unique external identity", async () => {
    const userId = await createUser();
    await getDatabase().db.insert(externalIdentities).values({
      userId,
      issuer: "https://identity.example.test",
      subject: "subject-1",
    });
    const repository = new DrizzleExternalIdentityRepository(getDatabase());

    await expect(
      repository.findUserByIdentity(
        "https://identity.example.test",
        "subject-1",
      ),
    ).resolves.toEqual({ id: userId, disabledAt: null });
    await expect(
      getDatabase()
        .db.insert(externalIdentities)
        .values({
          userId: await createUser(),
          issuer: "https://identity.example.test",
          subject: "subject-1",
        }),
    ).rejects.toThrow();
  });

  it("rejects malformed external identities", async () => {
    const userId = await createUser();
    await expect(
      getDatabase().db.insert(externalIdentities).values({
        userId,
        issuer: " ",
        subject: "subject-1",
      }),
    ).rejects.toThrow();
    await expect(
      getDatabase().db.insert(externalIdentities).values({
        userId,
        issuer: "https://identity.example.test",
        subject: " ",
      }),
    ).rejects.toThrow();
  });

  it("provisions identity and membership atomically and idempotently", async () => {
    const workspaceId = await createWorkspace();
    const repository = new DrizzleIdentityProvisioningRepository(getDatabase());
    const input = {
      issuer: "https://identity.example.test",
      subject: "subject-1",
      workspaceId,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    await expect(repository.workspaceExists(workspaceId)).resolves.toBe(true);
    await expect(repository.workspaceExists(randomUUID())).resolves.toBe(false);

    const first = await repository.provisionIdentityAndMembership(input);
    const second = await repository.provisionIdentityAndMembership(input);

    expect(second).toEqual(first);
    expect(first.membershipActive).toBe(true);
    await expect(
      new DrizzleWorkspaceMembershipRepository(
        getDatabase(),
      ).hasActiveMembership(first.userId, workspaceId),
    ).resolves.toBe(true);
  });

  it("does not provision a disabled external identity", async () => {
    const userId = await createUser(new Date("2026-01-01T01:00:00.000Z"));
    const workspaceId = await createWorkspace();
    await getDatabase().db.insert(externalIdentities).values({
      userId,
      issuer: "https://identity.example.test",
      subject: "subject-disabled",
    });
    const repository = new DrizzleIdentityProvisioningRepository(getDatabase());

    await expect(
      repository.provisionIdentityAndMembership({
        issuer: "https://identity.example.test",
        subject: "subject-disabled",
        workspaceId,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Cannot provision a disabled identity");
    await expect(
      new DrizzleWorkspaceMembershipRepository(
        getDatabase(),
      ).hasActiveMembership(userId, workspaceId),
    ).resolves.toBe(false);
  });

  it("serializes concurrent provisioning of the same external identity", async () => {
    requireTestDatabaseUrl(testDatabaseUrl);
    const firstDatabase = createDatabase(testDatabaseUrl, { max: 1 });
    const secondDatabase = createDatabase(testDatabaseUrl, { max: 1 });
    const workspaceId = await createWorkspace();
    const input = {
      issuer: "https://identity.example.test",
      subject: "subject-concurrent",
      workspaceId,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    try {
      const [first, second] = await Promise.all([
        new DrizzleIdentityProvisioningRepository(
          firstDatabase,
        ).provisionIdentityAndMembership(input),
        new DrizzleIdentityProvisioningRepository(
          secondDatabase,
        ).provisionIdentityAndMembership(input),
      ]);

      expect(second).toEqual(first);
      const [userCount] = await getDatabase()
        .db.select({ value: sql<number>`count(*)::int` })
        .from(users);
      const [identityCount] = await getDatabase()
        .db.select({ value: sql<number>`count(*)::int` })
        .from(externalIdentities)
        .where(
          sql`${externalIdentities.issuer} = ${input.issuer} and ${externalIdentities.subject} = ${input.subject}`,
        );
      const [membershipCount] = await getDatabase()
        .db.select({ value: sql<number>`count(*)::int` })
        .from(workspaceMemberships)
        .where(
          sql`${workspaceMemberships.userId} = ${first.userId} and ${workspaceMemberships.workspaceId} = ${workspaceId}`,
        );

      expect(userCount?.value).toBe(1);
      expect(identityCount?.value).toBe(1);
      expect(membershipCount?.value).toBe(1);
    } finally {
      await Promise.all([firstDatabase.close(), secondDatabase.close()]);
    }
  });

  it("does not reactivate a revoked membership during provisioning", async () => {
    const workspaceId = await createWorkspace();
    const repository = new DrizzleIdentityProvisioningRepository(getDatabase());
    const input = {
      issuer: "https://identity.example.test",
      subject: "subject-revoked",
      workspaceId,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const { userId } = await repository.provisionIdentityAndMembership(input);
    await getDatabase()
      .db.update(workspaceMemberships)
      .set({ revokedAt: new Date("2026-01-02T00:00:00.000Z") })
      .where(sql`${workspaceMemberships.userId} = ${userId}`);

    const reprovisioned =
      await repository.provisionIdentityAndMembership(input);

    expect(reprovisioned.membershipActive).toBe(false);
    await expect(
      new DrizzleWorkspaceMembershipRepository(
        getDatabase(),
      ).hasActiveMembership(userId, workspaceId),
    ).resolves.toBe(false);
  });

  it("rolls back provisioning when the workspace does not exist", async () => {
    const repository = new DrizzleIdentityProvisioningRepository(getDatabase());
    const identityRepository = new DrizzleExternalIdentityRepository(
      getDatabase(),
    );

    await expect(
      repository.provisionIdentityAndMembership({
        issuer: "https://identity.example.test",
        subject: "subject-rollback",
        workspaceId: randomUUID(),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow();
    await expect(
      identityRepository.findUserByIdentity(
        "https://identity.example.test",
        "subject-rollback",
      ),
    ).resolves.toBeNull();
    const [userCount] = await getDatabase()
      .db.select({ value: sql<number>`count(*)::int` })
      .from(users);
    expect(userCount?.value).toBe(0);
  });
});
