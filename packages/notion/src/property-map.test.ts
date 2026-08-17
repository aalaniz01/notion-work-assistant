import { describe, expect, it } from "vitest";

import { NotionConfigError } from "./errors.js";
import { createNotionConfiguration } from "./property-map.js";
import { TEST_ENVIRONMENT } from "./test-fixtures.js";

describe("Notion configuration", () => {
  it("uses centralized property defaults", () => {
    expect(createNotionConfiguration(TEST_ENVIRONMENT).properties).toEqual({
      clients: { name: "Name" },
      tasks: {
        title: "Tarea",
        clientRelation: "Clientes",
        taskType: "Tipo",
        dueDate: "Date",
        status: "Estado",
        priority: "Prioridad",
      },
    });
  });

  it.each([
    ["NOTION_TOKEN", ""],
    ["NOTION_CLIENTS_DATABASE_ID", "not-an-id"],
    ["NOTION_TASKS_DATABASE_ID", ""],
    ["NOTION_TASK_STATUS_PROPERTY", "   "],
  ])("rejects invalid %s", (name, value) => {
    expect(() =>
      createNotionConfiguration({ ...TEST_ENVIRONMENT, [name]: value }),
    ).toThrow(NotionConfigError);
  });

  it("rejects duplicate task property mappings", () => {
    expect(() =>
      createNotionConfiguration({
        ...TEST_ENVIRONMENT,
        NOTION_TASK_STATUS_PROPERTY: "Tipo",
      }),
    ).toThrow("Notion task property mappings must use distinct names");
  });

  it("rejects the same database ID for Clients and Tasks", () => {
    expect(() =>
      createNotionConfiguration({
        ...TEST_ENVIRONMENT,
        NOTION_TASKS_DATABASE_ID: TEST_ENVIRONMENT.NOTION_CLIENTS_DATABASE_ID,
      }),
    ).toThrow("Clients and Tasks must use distinct Notion database IDs");
  });
});
