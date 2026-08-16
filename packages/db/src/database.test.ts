import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "./client.js";
import { DrizzlePrioritySettingsRepository } from "./priority-settings-repository.js";
import { createDatabaseReadinessCheck } from "./readiness.js";
import { prioritySettings, workspaces } from "./schema.js";
import { requireTestDatabaseUrl } from "./test-database-safety.js";

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
  requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  await getDatabase().db.execute(
    sql`truncate table ${prioritySettings}, ${workspaces}`,
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
});
