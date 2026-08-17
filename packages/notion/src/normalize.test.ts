import type { TaskStatus } from "@notion-work-assistant/domain";
import { describe, expect, it } from "vitest";

import {
  NotionPropertyError,
  NotionRelationError,
  NotionValidationError,
} from "./errors.js";
import {
  normalizeClient,
  normalizeTask as normalizeNotionTask,
} from "./normalize.js";
import { createNotionConfiguration } from "./property-map.js";
import { clientPage, taskPage, TEST_ENVIRONMENT } from "./test-fixtures.js";

const properties = createNotionConfiguration(TEST_ENVIRONMENT).properties;

function normalizeTask(
  page: ReturnType<typeof taskPage>,
  taskProperties = properties.tasks,
) {
  const task = normalizeNotionTask(page, taskProperties);
  if (!task) throw new Error("Expected a linked task");
  return task;
}

describe("Notion page normalization", () => {
  it("concatenates every client title fragment", () => {
    expect(
      normalizeClient(
        clientPage("client-1", { title: ["North", "star"] }),
        properties.clients,
      ),
    ).toEqual({ id: "client-1", name: "Northstar" });
  });

  it("reads Tarea, Clientes, Tipo, Date, Estado, and Prioridad", () => {
    const task = normalizeTask(
      taskPage("task-1", { title: ["Campaign", " brief"] }),
      properties.tasks,
    );

    expect(task).toEqual({
      id: "task-1",
      title: "Campaign brief",
      clientId: "client-1",
      taskType: "Reel",
      dueDate: "2026-05-10",
      status: "NOT_STARTED",
      priority: "Alta",
    });
    expect(task).not.toHaveProperty("category");
    expect(task).not.toHaveProperty("subtype");
    expect(task).not.toHaveProperty("startDate");
  });

  it.each(["Reel", "SS creativo", "Planeación", "Branding", "RRSS"])(
    "preserves Tipo option %s",
    (taskType) => {
      expect(
        normalizeTask(
          taskPage("task-1", { taskType: ` ${taskType} ` }),
          properties.tasks,
        ).taskType,
      ).toBe(taskType);
    },
  );

  it("normalizes empty Tipo and Date values to null", () => {
    expect(
      normalizeTask(
        taskPage("task-1", { taskType: null, dueDate: null }),
        properties.tasks,
      ),
    ).toMatchObject({ taskType: null, dueDate: null });
  });

  it("preserves Date date.start as dueDate", () => {
    expect(
      normalizeTask(
        taskPage("task-1", {
          dueDate: "2026-05-10T09:30:00.000-05:00",
        }),
        properties.tasks,
      ).dueDate,
    ).toBe("2026-05-10T09:30:00.000-05:00");
  });

  it.each([
    ["Not started", "NOT_STARTED"],
    ["In progress", "IN_PROGRESS"],
    ["Done", "APPROVED"],
  ] as Array<[string, TaskStatus]>)(
    "maps current Estado label %s to %s",
    (input, expected) => {
      expect(
        normalizeTask(taskPage("task-1", { status: input }), properties.tasks)
          .status,
      ).toBe(expected);
    },
  );

  it.each([
    ["NOT_STARTED", "NOT_STARTED"],
    ["Not Started", "NOT_STARTED"],
    ["IN_PROGRESS", "IN_PROGRESS"],
    ["In Progress", "IN_PROGRESS"],
    ["WAITING_APPROVAL", "WAITING_APPROVAL"],
    ["Waiting Approval", "WAITING_APPROVAL"],
    ["CHANGES_REQUESTED", "CHANGES_REQUESTED"],
    ["Changes Requested", "CHANGES_REQUESTED"],
    ["APPROVED", "APPROVED"],
    ["Approved", "APPROVED"],
  ] as Array<[string, TaskStatus]>)(
    "retains future status alias %s",
    (input, expected) => {
      expect(
        normalizeTask(taskPage("task-1", { status: input }), properties.tasks)
          .status,
      ).toBe(expected);
    },
  );

  it.each(["Alta", "Media"])("preserves Prioridad option %s", (priority) => {
    expect(
      normalizeTask(
        taskPage("task-1", { priority: ` ${priority} ` }),
        properties.tasks,
      ).priority,
    ).toBe(priority);
  });

  it("normalizes an empty Prioridad to null", () => {
    expect(
      normalizeTask(taskPage("task-1", { priority: null }), properties.tasks)
        .priority,
    ).toBeNull();
  });

  it("ignores the non-canonical Cliente select", () => {
    const task = normalizeTask(
      taskPage("task-1", { clientName: "Private client name" }),
      properties.tasks,
    );

    expect(task.clientId).toBe("client-1");
    expect(task).not.toHaveProperty("clientName");
  });

  it("rejects a missing required Tarea title", () => {
    expect(() =>
      normalizeTask(taskPage("task-1", { title: [] }), properties.tasks),
    ).toThrow(NotionPropertyError);
  });

  it("rejects an incorrect Tipo property type", () => {
    const page = taskPage();
    page.properties.Tipo = {
      id: "task-type",
      type: "date",
      date: null,
    };
    expect(() => normalizeTask(page, properties.tasks)).toThrow(
      NotionPropertyError,
    );
  });

  it("rejects an unknown status without echoing it", () => {
    try {
      normalizeTask(
        taskPage("task-1", { status: "private-status" }),
        properties.tasks,
      );
      throw new Error("Expected normalization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotionValidationError);
      expect((error as Error).message).not.toContain("private-status");
    }
  });

  it.each(["constructor", "toString", "__proto__"])(
    "rejects inherited-object status name %s",
    (status) => {
      expect(() =>
        normalizeTask(taskPage("task-1", { status }), properties.tasks),
      ).toThrow(NotionValidationError);
    },
  );

  it("returns null for an empty Clientes relation", () => {
    expect(
      normalizeNotionTask(
        taskPage("task-1", { clientIds: [] }),
        properties.tasks,
      ),
    ).toBeNull();
  });

  it("rejects multiple Clientes relations", () => {
    expect(() =>
      normalizeNotionTask(
        taskPage("task-1", { clientIds: ["client-1", "client-2"] }),
        properties.tasks,
      ),
    ).toThrow(NotionRelationError);
  });

  it("rejects a truncated Clientes relation", () => {
    const page = taskPage();
    const relation = page.properties.Clientes;
    if (relation?.type !== "relation") throw new Error("Invalid test fixture");
    Object.assign(relation, { has_more: true });

    expect(() => normalizeNotionTask(page, properties.tasks)).toThrow(
      NotionRelationError,
    );
  });

  it("rejects a malformed Clientes relation item", () => {
    const page = taskPage();
    const relation = page.properties.Clientes;
    if (relation?.type !== "relation") throw new Error("Invalid test fixture");
    relation.relation = [{} as { id: string }];

    expect(() => normalizeNotionTask(page, properties.tasks)).toThrow(
      NotionRelationError,
    );
  });
});
