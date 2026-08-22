import type { PrioritySettings } from "@notion-work-assistant/domain";
import type { PrioritySettingsRepository } from "@notion-work-assistant/db";
import type { NotionReader, NotionTask } from "@notion-work-assistant/notion";
import { NotionApiError } from "@notion-work-assistant/notion";
import { describe, expect, it } from "vitest";

import {
  NotionDashboardService,
  type DashboardService,
} from "./dashboard-service.js";
import { NotionUnavailableError } from "./notion-unavailable.js";

const NOW = new Date("2026-05-10T12:00:00.000Z");
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function notionTask(overrides: Partial<NotionTask> = {}): NotionTask {
  return {
    id: "task-1",
    title: "Task",
    clientId: "client-1",
    taskType: null,
    dueDate: null,
    status: "NOT_STARTED",
    priority: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

function fakeReader(tasks: NotionTask[]): NotionReader {
  return {
    async validate() {},
    async fetchSnapshot() {
      return {
        clients: [
          { id: "client-1", name: "Northstar Studio" },
          { id: "client-2", name: "Fieldwork Labs" },
        ],
        tasks,
        skippedTasks: { missingClientRelation: 0 },
      };
    },
  };
}

function settingsRepository(
  settings: PrioritySettings | null,
): PrioritySettingsRepository {
  return {
    async findByWorkspaceId() {
      return settings;
    },
  };
}

function service(
  options: {
    reader?: NotionReader;
    settings?: PrioritySettingsRepository;
    now?: () => Date;
  } = {},
): DashboardService {
  return new NotionDashboardService(
    options.reader ?? fakeReader([notionTask()]),
    options.settings ?? settingsRepository(null),
    options.now ?? (() => NOW),
  );
}

async function deadlineScore(dueDate: string | null): Promise<number> {
  const dashboard = await service({
    reader: fakeReader([notionTask({ dueDate })]),
    settings: settingsRepository({
      workspaceId: WORKSPACE_ID,
      deadlineWeight: 100,
      waitingTimeWeight: 0,
      estimatedEffortWeight: 0,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  }).loadDashboard(WORKSPACE_ID);
  return dashboard.recommendations[0]!.priority.recommendationScore;
}

describe("NotionDashboardService", () => {
  it("maps clients and tasks into a sorted dashboard", async () => {
    const tasks = [
      notionTask({
        id: "task-a",
        dueDate: "2026-05-08",
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
      notionTask({
        id: "task-b",
        dueDate: "2026-05-20",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    ];
    const dashboard = await service({
      reader: fakeReader(tasks),
      settings: settingsRepository(null),
    }).loadDashboard(WORKSPACE_ID);

    expect(dashboard.clients).toEqual([
      { id: "client-1", name: "Northstar Studio" },
      { id: "client-2", name: "Fieldwork Labs" },
    ]);
    expect(dashboard.recommendations.map(({ task }) => task.id)).toEqual([
      "task-a",
      "task-b",
    ]);
  });

  it("excludes APPROVED and WAITING_APPROVAL tasks", async () => {
    const tasks = [
      notionTask({ id: "task-approved", status: "APPROVED" }),
      notionTask({ id: "task-waiting", status: "WAITING_APPROVAL" }),
      notionTask({ id: "task-active", status: "IN_PROGRESS" }),
    ];
    const dashboard = await service({
      reader: fakeReader(tasks),
    }).loadDashboard(WORKSPACE_ID);

    expect(dashboard.recommendations.map(({ task }) => task.id)).toEqual([
      "task-active",
    ]);
  });

  it("returns an empty dashboard for an empty task snapshot", async () => {
    const dashboard = await service({ reader: fakeReader([]) }).loadDashboard(
      WORKSPACE_ID,
    );

    expect(dashboard).toEqual({
      clients: [
        { id: "client-1", name: "Northstar Studio" },
        { id: "client-2", name: "Fieldwork Labs" },
      ],
      recommendations: [],
    });
  });

  describe("deadline factor", () => {
    it.each([
      [null, 0],
      ["2026-05-08", 100],
      ["2026-05-09", 100],
      ["2026-05-10", 100],
      ["2026-05-11", 90],
      ["2026-05-12", 80],
      ["2026-05-19", 10],
      ["2026-05-20", 0],
      ["2026-06-01", 0],
    ] as const)(
      "maps dueDate %s to deadline factor %s",
      async (dueDate, expected) => {
        await expect(deadlineScore(dueDate)).resolves.toBe(expected);
      },
    );
  });

  it("scores a task with deadline pressure using default weights", async () => {
    const tasks = [notionTask({ dueDate: "2026-05-08" })];
    const dashboard = await service({
      reader: fakeReader(tasks),
    }).loadDashboard(WORKSPACE_ID);
    const priority = dashboard.recommendations[0]!.priority;

    expect(priority.recommendationScore).toBe(75);
    expect(priority.priorityLevel).toBe("HIGH");
  });

  it("uses stored priority_settings weights when a row exists", async () => {
    const tasks = [notionTask({ dueDate: "2026-05-08" })];
    const settings: PrioritySettings = {
      workspaceId: WORKSPACE_ID,
      deadlineWeight: 100,
      waitingTimeWeight: 0,
      estimatedEffortWeight: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const dashboard = await service({
      reader: fakeReader(tasks),
      settings: settingsRepository(settings),
    }).loadDashboard(WORKSPACE_ID);

    expect(dashboard.recommendations[0]!.priority.recommendationScore).toBe(
      100,
    );
  });

  it("fails the request when the settings read fails instead of using defaults", async () => {
    const reader = fakeReader([notionTask()]);
    const failing: PrioritySettingsRepository = {
      async findByWorkspaceId() {
        throw new Error("database unreachable");
      },
    };

    await expect(
      service({ reader, settings: failing }).loadDashboard(WORKSPACE_ID),
    ).rejects.toThrow("database unreachable");
  });

  it("translates Notion errors to a safe NOTION_UNAVAILABLE envelope", async () => {
    const reader: NotionReader = {
      async validate() {},
      async fetchSnapshot() {
        throw new NotionApiError(
          "NOTION_UNAUTHORIZED",
          "unsafe message with page id",
        );
      },
    };

    const operation = service({ reader }).loadDashboard(WORKSPACE_ID);

    await expect(operation).rejects.toBeInstanceOf(NotionUnavailableError);
    await expect(operation).rejects.toMatchObject({
      code: "NOTION_UNAVAILABLE",
    });
    await expect(operation).rejects.toMatchObject({
      reason: "NOTION_UNAUTHORIZED",
    });
    await expect(operation).rejects.not.toHaveProperty(
      "message",
      "unsafe message with page id",
    );
  });

  it("rethrows unexpected reader failures without translating them", async () => {
    const reader: NotionReader = {
      async validate() {},
      async fetchSnapshot() {
        throw new Error("unexpected adapter failure");
      },
    };

    await expect(
      service({ reader }).loadDashboard(WORKSPACE_ID),
    ).rejects.toThrow("unexpected adapter failure");
  });
});
