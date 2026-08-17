import {
  APIErrorCode,
  APIResponseError,
  isFullDatabase,
  isFullDataSource,
  isFullPage,
  RequestTimeoutError,
  UnknownHTTPResponseError,
  type DataSourceObjectResponse,
  type PageObjectResponse,
} from "@notionhq/client";

import {
  NotionAdapterError,
  NotionApiError,
  NotionDataSourceError,
  NotionPaginationError,
  NotionRelationError,
  NotionSchemaError,
  NotionTimeoutError,
  NotionValidationError,
} from "./errors.js";
import {
  createNotionReadClient,
  iterateNotionDataSourceRows,
  type NotionReadClient,
} from "./notion-client.js";
import { normalizeClient, normalizeTask } from "./normalize.js";
import {
  createNotionConfiguration,
  type NotionConfiguration,
  type NotionEnvironment,
  type PropertyMap,
  validateNotionConfiguration,
} from "./property-map.js";
import type {
  NotionClient,
  NotionReader,
  NotionSnapshot,
  NotionTask,
} from "./types.js";

const NOTION_PAGE_SIZE = 100;
export const MAX_ROWS_PER_DATA_SOURCE = 5_000;

type SchemaPropertyType = "title" | "relation" | "select" | "date" | "status";

interface SchemaRequirement {
  name: string;
  type: SchemaPropertyType;
  required: boolean;
}

function mapNotionError(error: unknown): NotionAdapterError {
  if (error instanceof NotionAdapterError) return error;
  if (RequestTimeoutError.isRequestTimeoutError(error)) {
    return new NotionTimeoutError(error);
  }
  if (APIResponseError.isAPIResponseError(error)) {
    const options = { cause: error, httpStatus: error.status };
    switch (error.code) {
      case APIErrorCode.Unauthorized:
        return new NotionApiError(
          "NOTION_UNAUTHORIZED",
          "Notion rejected the integration token",
          options,
        );
      case APIErrorCode.RestrictedResource:
        return new NotionApiError(
          "NOTION_RESTRICTED_RESOURCE",
          "Notion resource access is restricted",
          options,
        );
      case APIErrorCode.ObjectNotFound:
        return new NotionApiError(
          "NOTION_OBJECT_NOT_FOUND",
          "Notion database was not found or was not shared",
          options,
        );
      case APIErrorCode.RateLimited:
        return new NotionApiError(
          "NOTION_RATE_LIMITED",
          "Notion rate limit was exceeded",
          options,
        );
      default:
        return new NotionApiError(
          "NOTION_API_ERROR",
          "Notion API request failed",
          options,
        );
    }
  }
  if (UnknownHTTPResponseError.isUnknownHTTPResponseError(error)) {
    return new NotionApiError(
      "NOTION_API_ERROR",
      "Notion API returned an invalid error response",
      { cause: error, httpStatus: error.status },
    );
  }

  return new NotionApiError(
    "NOTION_NETWORK_ERROR",
    "Notion network request failed",
    { cause: error },
  );
}

async function notionCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapNotionError(error);
  }
}

function validateSchema(
  dataSource: DataSourceObjectResponse,
  label: "Clients" | "Tasks",
  requirements: SchemaRequirement[],
): void {
  if (dataSource.in_trash) {
    throw new NotionSchemaError(`${label} data source is in trash`);
  }

  for (const requirement of requirements) {
    const property = dataSource.properties[requirement.name];
    if (!property) {
      if (!requirement.required) continue;
      throw new NotionSchemaError(
        `${label} data source is missing required property "${requirement.name}"`,
      );
    }
    if (property.type !== requirement.type) {
      throw new NotionSchemaError(
        `${label} property "${requirement.name}" must have type "${requirement.type}"`,
      );
    }
  }
}

function clientRequirements(
  properties: PropertyMap["clients"],
): SchemaRequirement[] {
  return [{ name: properties.name, type: "title", required: true }];
}

function taskRequirements(
  properties: PropertyMap["tasks"],
): SchemaRequirement[] {
  return [
    { name: properties.title, type: "title", required: true },
    { name: properties.clientRelation, type: "relation", required: true },
    { name: properties.taskType, type: "select", required: false },
    { name: properties.dueDate, type: "date", required: false },
    { name: properties.status, type: "status", required: true },
    { name: properties.priority, type: "select", required: false },
  ];
}

export class NotionReaderImplementation implements NotionReader {
  constructor(
    private readonly configuration: NotionConfiguration,
    private readonly client: NotionReadClient,
  ) {}

  async validate(): Promise<void> {
    validateNotionConfiguration(this.configuration);
    await this.discoverAndValidateDataSources();
  }

  async fetchSnapshot(): Promise<NotionSnapshot> {
    validateNotionConfiguration(this.configuration);
    const { clientsDataSourceId, tasksDataSourceId } =
      await this.discoverAndValidateDataSources();

    const { rows: clients } = await this.readDataSource(
      clientsDataSourceId,
      (page) => normalizeClient(page, this.configuration.properties.clients),
    );
    const { rows: tasks, skippedRows: missingClientRelation } =
      await this.readDataSource(tasksDataSourceId, (page) =>
        normalizeTask(page, this.configuration.properties.tasks),
      );

    this.validateRelations(clients, tasks);
    return {
      clients,
      tasks,
      skippedTasks: { missingClientRelation },
    };
  }

  private async discoverAndValidateDataSources(): Promise<{
    clientsDataSourceId: string;
    tasksDataSourceId: string;
  }> {
    const clientsDataSourceId = await this.discoverDataSource(
      this.configuration.clientsDatabaseId,
      "Clients",
    );
    const tasksDataSourceId = await this.discoverDataSource(
      this.configuration.tasksDatabaseId,
      "Tasks",
    );

    const [clientsDataSource, tasksDataSource] = await Promise.all([
      notionCall(() =>
        this.client.dataSources.retrieve({
          data_source_id: clientsDataSourceId,
        }),
      ),
      notionCall(() =>
        this.client.dataSources.retrieve({
          data_source_id: tasksDataSourceId,
        }),
      ),
    ]);

    if (!isFullDataSource(clientsDataSource)) {
      throw new NotionSchemaError("Clients data source response is incomplete");
    }
    if (!isFullDataSource(tasksDataSource)) {
      throw new NotionSchemaError("Tasks data source response is incomplete");
    }

    validateSchema(
      clientsDataSource,
      "Clients",
      clientRequirements(this.configuration.properties.clients),
    );
    validateSchema(
      tasksDataSource,
      "Tasks",
      taskRequirements(this.configuration.properties.tasks),
    );
    const clientRelation =
      tasksDataSource.properties[
        this.configuration.properties.tasks.clientRelation
      ];
    if (
      clientRelation?.type !== "relation" ||
      clientRelation.relation.data_source_id !== clientsDataSourceId
    ) {
      throw new NotionSchemaError(
        `Tasks property "${this.configuration.properties.tasks.clientRelation}" must relate to the configured Clients data source`,
      );
    }

    return { clientsDataSourceId, tasksDataSourceId };
  }

  private async discoverDataSource(
    databaseId: string,
    label: "Clients" | "Tasks",
  ): Promise<string> {
    const database = await notionCall(() =>
      this.client.databases.retrieve({ database_id: databaseId }),
    );
    if (!isFullDatabase(database)) {
      throw new NotionSchemaError(`${label} database response is incomplete`);
    }
    if (database.in_trash) {
      throw new NotionSchemaError(`${label} database is in trash`);
    }
    if (database.data_sources.length !== 1) {
      throw new NotionDataSourceError(
        `${label} database must contain exactly one data source; found ${database.data_sources.length}`,
      );
    }
    return database.data_sources[0]!.id;
  }

  private async readDataSource<T>(
    dataSourceId: string,
    normalize: (page: PageObjectResponse) => T | null,
  ): Promise<{ rows: T[]; skippedRows: number }> {
    const rows: T[] = [];
    let rowCount = 0;
    let skippedRows = 0;

    try {
      for await (const result of iterateNotionDataSourceRows(this.client, {
        data_source_id: dataSourceId,
        page_size: NOTION_PAGE_SIZE,
        result_type: "page",
      })) {
        rowCount += 1;
        if (rowCount > MAX_ROWS_PER_DATA_SOURCE) {
          throw new NotionPaginationError(
            `Notion data source exceeds the ${MAX_ROWS_PER_DATA_SOURCE}-row safety limit`,
          );
        }
        if (!isFullPage(result)) {
          throw new NotionValidationError(
            "Notion data source query returned an unexpected result object",
          );
        }
        if (result.in_trash) continue;
        const normalized = normalize(result);
        if (normalized === null) {
          skippedRows += 1;
        } else {
          rows.push(normalized);
        }
      }
    } catch (error) {
      if (error instanceof NotionAdapterError) throw error;
      if (
        error instanceof Error &&
        error.message.startsWith(
          "iterateAllDataSourceRows cannot make progress",
        )
      ) {
        throw new NotionPaginationError(
          "Notion pagination could not advance safely",
          error,
        );
      }
      throw mapNotionError(error);
    }

    return { rows, skippedRows };
  }

  private validateRelations(
    clients: NotionClient[],
    tasks: NotionTask[],
  ): void {
    const clientIds = new Set(clients.map((client) => client.id));
    for (const task of tasks) {
      if (!clientIds.has(task.clientId)) {
        throw new NotionRelationError(
          `Task page ${task.id} references a client page that is unavailable`,
        );
      }
    }
  }
}

export function createNotionReader(
  environment: NotionEnvironment = process.env,
): NotionReader {
  const configuration = createNotionConfiguration(environment);
  return new NotionReaderImplementation(
    configuration,
    createNotionReadClient(configuration.token),
  );
}
