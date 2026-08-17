import type {
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  PageObjectResponse,
  QueryDataSourceResponse,
  RichTextItemResponse,
} from "@notionhq/client";

export const CLIENTS_DATABASE_ID = "11111111-1111-4111-8111-111111111111";
export const TASKS_DATABASE_ID = "22222222-2222-4222-8222-222222222222";
export const CLIENTS_DATA_SOURCE_ID = "clients-data-source";
export const TASKS_DATA_SOURCE_ID = "tasks-data-source";

export const TEST_ENVIRONMENT = {
  NOTION_TOKEN: "test-token",
  NOTION_CLIENTS_DATABASE_ID: CLIENTS_DATABASE_ID,
  NOTION_TASKS_DATABASE_ID: TASKS_DATABASE_ID,
};

export function richText(...fragments: string[]): RichTextItemResponse[] {
  return fragments.map(
    (plainText) =>
      ({
        type: "text",
        text: { content: plainText, link: null },
        plain_text: plainText,
        href: null,
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      }) as RichTextItemResponse,
  );
}

export function database(
  id: string,
  dataSourceIds: string[],
): DatabaseObjectResponse {
  return {
    object: "database",
    id,
    title: [],
    description: [],
    parent: { type: "workspace", workspace: true },
    is_inline: false,
    in_trash: false,
    archived: false,
    is_locked: false,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    data_sources: dataSourceIds.map((dataSourceId) => ({
      id: dataSourceId,
      name: "Data source",
    })),
    icon: null,
    cover: null,
    url: "https://www.notion.so/database",
    public_url: null,
  };
}

export function clientsDataSource(): DataSourceObjectResponse {
  return dataSource(CLIENTS_DATA_SOURCE_ID, {
    Name: {
      id: "client-title",
      name: "Name",
      description: null,
      type: "title",
      title: {},
    },
  });
}

export function tasksDataSource(): DataSourceObjectResponse {
  return dataSource(TASKS_DATA_SOURCE_ID, {
    Tarea: {
      id: "task-title",
      name: "Tarea",
      description: null,
      type: "title",
      title: {},
    },
    Clientes: {
      id: "task-client",
      name: "Clientes",
      description: null,
      type: "relation",
      relation: {
        data_source_id: CLIENTS_DATA_SOURCE_ID,
        database_id: CLIENTS_DATABASE_ID,
        type: "single_property",
        single_property: {},
      },
    },
    Cliente: {
      id: "ignored-client-name",
      name: "Cliente",
      description: null,
      type: "select",
      select: { options: [] },
    },
    Tipo: {
      id: "task-type",
      name: "Tipo",
      description: null,
      type: "select",
      select: { options: [] },
    },
    Date: {
      id: "task-due",
      name: "Date",
      description: null,
      type: "date",
      date: {},
    },
    Estado: {
      id: "task-status",
      name: "Estado",
      description: null,
      type: "status",
      status: { options: [], groups: [] },
    },
    Prioridad: {
      id: "task-priority",
      name: "Prioridad",
      description: null,
      type: "select",
      select: { options: [] },
    },
    Checkbox: {
      id: "ignored-checkbox",
      name: "Checkbox",
      description: null,
      type: "checkbox",
      checkbox: {},
    },
  });
}

function dataSource(
  id: string,
  properties: DataSourceObjectResponse["properties"],
): DataSourceObjectResponse {
  return {
    object: "data_source",
    id,
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "parent-database" },
    database_parent: { type: "workspace", workspace: true },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    created_by: { object: "user", id: "user" },
    last_edited_by: { object: "user", id: "user" },
    properties,
    icon: null,
    cover: null,
    url: "https://www.notion.so/data-source",
    public_url: null,
  };
}

export function clientPage(
  id = "client-1",
  options: { inTrash?: boolean; title?: string[] } = {},
): PageObjectResponse {
  return page(id, options.inTrash ?? false, {
    Name: {
      id: "title",
      type: "title",
      title: richText(...(options.title ?? ["Client"])),
    },
  });
}

export function taskPage(
  id = "task-1",
  options: {
    clientName?: string | null;
    clientIds?: string[];
    dueDate?: string | null;
    inTrash?: boolean;
    priority?: string | null;
    status?: string;
    taskType?: string | null;
    title?: string[];
  } = {},
): PageObjectResponse {
  const select = (name: string | null) =>
    name
      ? {
          id: name.toLowerCase().replaceAll(" ", "-"),
          name,
          color: "default" as const,
        }
      : null;
  const date = (start: string | null) =>
    start ? { start, end: null, time_zone: null } : null;

  return page(id, options.inTrash ?? false, {
    Tarea: {
      id: "title",
      type: "title",
      title: richText(...(options.title ?? ["Task"])),
    },
    Clientes: {
      id: "client",
      type: "relation",
      relation: (options.clientIds ?? ["client-1"]).map((relationId) => ({
        id: relationId,
      })),
    },
    Cliente: {
      id: "ignored-client-name",
      type: "select",
      select: select(
        options.clientName === undefined
          ? "Ignored client name"
          : options.clientName,
      ),
    },
    Tipo: {
      id: "task-type",
      type: "select",
      select: select(
        options.taskType === undefined ? "Reel" : options.taskType,
      ),
    },
    Date: {
      id: "due",
      type: "date",
      date: date(
        options.dueDate === undefined ? "2026-05-10" : options.dueDate,
      ),
    },
    Estado: {
      id: "status",
      type: "status",
      status: select(options.status ?? "Not started"),
    },
    Prioridad: {
      id: "priority",
      type: "select",
      select: select(
        options.priority === undefined ? "Alta" : options.priority,
      ),
    },
    Checkbox: { id: "ignored-checkbox", type: "checkbox", checkbox: false },
  });
}

function page(
  id: string,
  inTrash: boolean,
  properties: PageObjectResponse["properties"],
): PageObjectResponse {
  return {
    object: "page",
    id,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    in_trash: inTrash,
    archived: inTrash,
    is_archived: false,
    is_locked: false,
    url: "https://www.notion.so/page",
    public_url: null,
    parent: {
      type: "data_source_id",
      data_source_id: "data-source",
      database_id: "database",
    },
    properties,
    icon: null,
    cover: null,
    created_by: { object: "user", id: "user" },
    last_edited_by: { object: "user", id: "user" },
  };
}

export function queryResponse(
  results: QueryDataSourceResponse["results"],
  nextCursor: string | null = null,
): QueryDataSourceResponse {
  return {
    object: "list",
    type: "page_or_data_source",
    page_or_data_source: {},
    results,
    has_more: nextCursor !== null,
    next_cursor: nextCursor,
    request_status: { type: "complete" },
  };
}
