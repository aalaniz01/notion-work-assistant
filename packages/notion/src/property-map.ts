import { NotionConfigError } from "./errors.js";

export interface PropertyMap {
  clients: {
    name: string;
  };
  tasks: {
    title: string;
    clientRelation: string;
    taskType: string;
    dueDate: string;
    status: string;
    priority: string;
  };
}

export interface NotionConfiguration {
  token: string;
  clientsDatabaseId: string;
  tasksDatabaseId: string;
  properties: PropertyMap;
}

export type NotionEnvironment = Readonly<Record<string, string | undefined>>;

const DATABASE_ID_PATTERN =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function requiredValue(environment: NotionEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new NotionConfigError(`${name} must be non-empty`);
  return value;
}

function propertyName(
  environment: NotionEnvironment,
  name: string,
  defaultValue: string,
): string {
  const configured = environment[name];
  if (configured === undefined) return defaultValue;

  const value = configured.trim();
  if (!value) throw new NotionConfigError(`${name} must be non-empty`);
  return value;
}

export function createNotionConfiguration(
  environment: NotionEnvironment,
): NotionConfiguration {
  const token = requiredValue(environment, "NOTION_TOKEN");
  const clientsDatabaseId = requiredValue(
    environment,
    "NOTION_CLIENTS_DATABASE_ID",
  );
  const tasksDatabaseId = requiredValue(
    environment,
    "NOTION_TASKS_DATABASE_ID",
  );

  for (const [name, value] of [
    ["NOTION_CLIENTS_DATABASE_ID", clientsDatabaseId],
    ["NOTION_TASKS_DATABASE_ID", tasksDatabaseId],
  ] as const) {
    if (!DATABASE_ID_PATTERN.test(value)) {
      throw new NotionConfigError(`${name} must be a valid Notion database ID`);
    }
  }

  if (clientsDatabaseId === tasksDatabaseId) {
    throw new NotionConfigError(
      "Clients and Tasks must use distinct Notion database IDs",
    );
  }

  const properties: PropertyMap = {
    clients: {
      name: propertyName(environment, "NOTION_CLIENT_NAME_PROPERTY", "Name"),
    },
    tasks: {
      title: propertyName(environment, "NOTION_TASK_TITLE_PROPERTY", "Tarea"),
      clientRelation: propertyName(
        environment,
        "NOTION_TASK_CLIENT_RELATION_PROPERTY",
        "Clientes",
      ),
      taskType: propertyName(environment, "NOTION_TASK_TYPE_PROPERTY", "Tipo"),
      dueDate: propertyName(
        environment,
        "NOTION_TASK_DUE_DATE_PROPERTY",
        "Date",
      ),
      status: propertyName(
        environment,
        "NOTION_TASK_STATUS_PROPERTY",
        "Estado",
      ),
      priority: propertyName(
        environment,
        "NOTION_TASK_PRIORITY_PROPERTY",
        "Prioridad",
      ),
    },
  };

  const taskPropertyNames = Object.values(properties.tasks);
  if (new Set(taskPropertyNames).size !== taskPropertyNames.length) {
    throw new NotionConfigError(
      "Notion task property mappings must use distinct names",
    );
  }

  return { token, clientsDatabaseId, tasksDatabaseId, properties };
}

export function validateNotionConfiguration(
  configuration: NotionConfiguration,
): void {
  createNotionConfiguration({
    NOTION_TOKEN: configuration.token,
    NOTION_CLIENTS_DATABASE_ID: configuration.clientsDatabaseId,
    NOTION_TASKS_DATABASE_ID: configuration.tasksDatabaseId,
    NOTION_CLIENT_NAME_PROPERTY: configuration.properties.clients.name,
    NOTION_TASK_TITLE_PROPERTY: configuration.properties.tasks.title,
    NOTION_TASK_CLIENT_RELATION_PROPERTY:
      configuration.properties.tasks.clientRelation,
    NOTION_TASK_TYPE_PROPERTY: configuration.properties.tasks.taskType,
    NOTION_TASK_DUE_DATE_PROPERTY: configuration.properties.tasks.dueDate,
    NOTION_TASK_STATUS_PROPERTY: configuration.properties.tasks.status,
    NOTION_TASK_PRIORITY_PROPERTY: configuration.properties.tasks.priority,
  });
}
