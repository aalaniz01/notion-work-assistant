import {
  APIErrorCode,
  APIResponseError,
  RequestTimeoutError,
  UnknownHTTPResponseError,
  type DataSourceObjectResponse,
  type QueryDataSourceParameters,
} from "@notionhq/client";
import { describe, expect, it } from "vitest";

import {
  NotionApiError,
  NotionConfigError,
  NotionDataSourceError,
  NotionPaginationError,
  NotionRelationError,
  NotionSchemaError,
  NotionTimeoutError,
  NotionValidationError,
} from "./errors.js";
import type { NotionReadClient } from "./notion-client.js";
import { createNotionConfiguration } from "./property-map.js";
import {
  MAX_ROWS_PER_DATA_SOURCE,
  NotionReaderImplementation,
} from "./reader.js";
import {
  CLIENTS_DATABASE_ID,
  CLIENTS_DATA_SOURCE_ID,
  clientPage,
  clientsDataSource,
  database,
  queryResponse,
  TASKS_DATA_SOURCE_ID,
  taskPage,
  tasksDataSource,
  TEST_ENVIRONMENT,
} from "./test-fixtures.js";

type Query = NotionReadClient["dataSources"]["query"];

function fakeClient(
  options: {
    clientsDataSource?: DataSourceObjectResponse;
    databasesRetrieve?: NotionReadClient["databases"]["retrieve"];
    query?: Query;
    tasksDataSource?: DataSourceObjectResponse;
  } = {},
): NotionReadClient {
  const clientsSchema = options.clientsDataSource ?? clientsDataSource();
  const tasksSchema = options.tasksDataSource ?? tasksDataSource();

  return {
    databases: {
      retrieve:
        options.databasesRetrieve ??
        (async ({ database_id }) =>
          database(
            database_id,
            database_id === CLIENTS_DATABASE_ID
              ? [CLIENTS_DATA_SOURCE_ID]
              : [TASKS_DATA_SOURCE_ID],
          )),
    },
    dataSources: {
      retrieve: async ({ data_source_id }) =>
        data_source_id === CLIENTS_DATA_SOURCE_ID ? clientsSchema : tasksSchema,
      query:
        options.query ??
        (async ({ data_source_id }) =>
          queryResponse(
            data_source_id === CLIENTS_DATA_SOURCE_ID
              ? [clientPage()]
              : [taskPage()],
          )),
    },
  };
}

function reader(client: NotionReadClient): NotionReaderImplementation {
  return new NotionReaderImplementation(
    createNotionConfiguration(TEST_ENVIRONMENT),
    client,
  );
}

function apiError(code: APIErrorCode, status: number): APIResponseError {
  return new APIResponseError({
    code,
    status,
    message: "unsafe upstream message",
    headers: new Headers(),
    rawBodyText: "unsafe raw response",
    additional_data: undefined,
    request_id: "request-id",
  });
}

describe("Notion reader", () => {
  it("discovers, validates, normalizes, and checks relations on direct fetch", async () => {
    const snapshot = await reader(fakeClient()).fetchSnapshot();

    expect(snapshot.clients).toEqual([{ id: "client-1", name: "Client" }]);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]).toMatchObject({
      id: "task-1",
      clientId: "client-1",
      status: "NOT_STARTED",
    });
    expect(snapshot.skippedTasks).toEqual({ missingClientRelation: 0 });
  });

  it("skips tasks with an empty Clientes relation and reports the count", async () => {
    const snapshot = await reader(
      fakeClient({
        query: async ({ data_source_id }) =>
          queryResponse(
            data_source_id === CLIENTS_DATA_SOURCE_ID
              ? [clientPage()]
              : [
                  taskPage("task-unlinked", { clientIds: [] }),
                  taskPage("task-linked"),
                ],
          ),
      }),
    ).fetchSnapshot();

    expect(snapshot.tasks.map(({ id }) => id)).toEqual(["task-linked"]);
    expect(snapshot.skippedTasks).toEqual({ missingClientRelation: 1 });
  });

  it("returns a valid empty task snapshot when every task is unlinked", async () => {
    const snapshot = await reader(
      fakeClient({
        query: async ({ data_source_id }) =>
          queryResponse(
            data_source_id === CLIENTS_DATA_SOURCE_ID
              ? [clientPage()]
              : [
                  taskPage("task-unlinked-1", { clientIds: [] }),
                  taskPage("task-unlinked-2", { clientIds: [] }),
                ],
          ),
      }),
    ).fetchSnapshot();

    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.skippedTasks).toEqual({ missingClientRelation: 2 });
  });

  it("revalidates configuration when fetchSnapshot is called directly", async () => {
    const configuration = createNotionConfiguration(TEST_ENVIRONMENT);
    const client = fakeClient();
    configuration.token = "";

    await expect(
      new NotionReaderImplementation(configuration, client).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionConfigError);
  });

  it("supports explicit validation without storing mutable validation state", async () => {
    let databaseReads = 0;
    const client = fakeClient({
      databasesRetrieve: async ({ database_id }) => {
        databaseReads += 1;
        return database(
          database_id,
          database_id === CLIENTS_DATABASE_ID
            ? [CLIENTS_DATA_SOURCE_ID]
            : [TASKS_DATA_SOURCE_ID],
        );
      },
    });
    const notionReader = reader(client);

    await notionReader.validate();
    await notionReader.fetchSnapshot();

    expect(databaseReads).toBe(4);
  });

  it("uses official cursor pagination for multiple normal pages", async () => {
    const calls: QueryDataSourceParameters[] = [];
    const client = fakeClient({
      query: async (args) => {
        calls.push(args);
        if (args.data_source_id === CLIENTS_DATA_SOURCE_ID) {
          return args.start_cursor === "clients-next"
            ? queryResponse([clientPage("client-2")])
            : queryResponse([clientPage("client-1")], "clients-next");
        }
        return queryResponse([taskPage("task-1", { clientIds: ["client-2"] })]);
      },
    });

    const snapshot = await reader(client).fetchSnapshot();

    expect(snapshot.clients.map(({ id }) => id)).toEqual([
      "client-1",
      "client-2",
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      page_size: 100,
      result_type: "page",
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
    });
    expect(calls[0]?.filter).toBeUndefined();
    expect(calls[1]?.start_cursor).toBe("clients-next");
  });

  it("uses the official helper to continue after a query result limit", async () => {
    let clientsQueries = 0;
    const client = fakeClient({
      query: async ({ data_source_id }) => {
        if (data_source_id !== CLIENTS_DATA_SOURCE_ID) {
          return queryResponse([
            taskPage("task-1", { clientIds: ["client-2"] }),
          ]);
        }

        clientsQueries += 1;
        if (clientsQueries === 1) {
          const response = queryResponse([clientPage("client-1")]);
          response.request_status = {
            type: "incomplete",
            incomplete_reason: "query_result_limit_reached",
          };
          return response;
        }
        return queryResponse([clientPage("client-1"), clientPage("client-2")]);
      },
    });

    const snapshot = await reader(client).fetchSnapshot();

    expect(snapshot.clients.map(({ id }) => id)).toEqual([
      "client-1",
      "client-2",
    ]);
    expect(clientsQueries).toBe(2);
  });

  it("stops at the row limit and returns no partial snapshot", async () => {
    const tooManyRows = Array.from(
      { length: MAX_ROWS_PER_DATA_SOURCE + 1 },
      (_, index) => clientPage(`client-${index}`),
    );
    const notionReader = reader(
      fakeClient({
        query: async ({ data_source_id }) =>
          queryResponse(
            data_source_id === CLIENTS_DATA_SOURCE_ID
              ? tooManyRows
              : [taskPage()],
          ),
      }),
    );

    const operation = notionReader.fetchSnapshot();
    await expect(operation).rejects.toBeInstanceOf(NotionPaginationError);
    await expect(operation).rejects.toMatchObject({
      code: "NOTION_ROW_LIMIT_ERROR",
    });
  });

  it("skips trashed client and task pages", async () => {
    const snapshot = await reader(
      fakeClient({
        query: async ({ data_source_id }) =>
          queryResponse(
            data_source_id === CLIENTS_DATA_SOURCE_ID
              ? [clientPage("client-trashed", { inTrash: true }), clientPage()]
              : [taskPage("task-trashed", { inTrash: true }), taskPage()],
          ),
      }),
    ).fetchSnapshot();

    expect(snapshot.clients.map(({ id }) => id)).toEqual(["client-1"]);
    expect(snapshot.tasks.map(({ id }) => id)).toEqual(["task-1"]);
  });

  it("rejects unexpected non-page query results", async () => {
    await expect(
      reader(
        fakeClient({
          query: async ({ data_source_id }) =>
            queryResponse(
              data_source_id === CLIENTS_DATA_SOURCE_ID
                ? [clientsDataSource()]
                : [taskPage()],
            ),
        }),
      ).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionValidationError);
  });

  it.each([0, 2])(
    "rejects a database with %i child data sources",
    async (count) => {
      await expect(
        reader(
          fakeClient({
            databasesRetrieve: async ({ database_id }) =>
              database(
                database_id,
                database_id === CLIENTS_DATABASE_ID
                  ? Array.from(
                      { length: count },
                      (_, index) => `source-${index}`,
                    )
                  : [TASKS_DATA_SOURCE_ID],
              ),
          }),
        ).fetchSnapshot(),
      ).rejects.toBeInstanceOf(NotionDataSourceError);
    },
  );

  it("rejects missing required schema properties", async () => {
    const schema = tasksDataSource();
    delete schema.properties.Estado;

    await expect(
      reader(fakeClient({ tasksDataSource: schema })).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionSchemaError);
  });

  it("rejects a missing Clientes schema property", async () => {
    const schema = tasksDataSource();
    delete schema.properties.Clientes;

    await expect(
      reader(fakeClient({ tasksDataSource: schema })).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionSchemaError);
  });

  it("rejects a non-relation Clientes schema property", async () => {
    const schema = tasksDataSource();
    schema.properties.Clientes = {
      id: "task-client",
      name: "Clientes",
      description: null,
      type: "select",
      select: { options: [] },
    };

    await expect(
      reader(fakeClient({ tasksDataSource: schema })).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionSchemaError);
  });

  it("allows an absent optional schema property", async () => {
    const schema = tasksDataSource();
    delete schema.properties.Tipo;
    const task = taskPage();
    delete task.properties.Tipo;

    await expect(
      reader(
        fakeClient({
          tasksDataSource: schema,
          query: async ({ data_source_id }) =>
            queryResponse(
              data_source_id === CLIENTS_DATA_SOURCE_ID
                ? [clientPage()]
                : [task],
            ),
        }),
      ).fetchSnapshot(),
    ).resolves.toMatchObject({ tasks: [{ taskType: null }] });
  });

  it("rejects an incorrect optional schema property type", async () => {
    const schema = tasksDataSource();
    schema.properties.Tipo = {
      id: "task-type",
      name: "Tipo",
      description: null,
      type: "date",
      date: {},
    };

    await expect(
      reader(fakeClient({ tasksDataSource: schema })).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionSchemaError);
  });

  it("rejects a Clientes relation targeting another data source", async () => {
    const schema = tasksDataSource();
    const relation = schema.properties.Clientes;
    if (relation?.type !== "relation") throw new Error("Invalid test fixture");
    relation.relation.data_source_id = "another-data-source";

    await expect(
      reader(fakeClient({ tasksDataSource: schema })).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionSchemaError);
  });

  it("rejects a relation to a missing client", async () => {
    await expect(
      reader(
        fakeClient({
          query: async ({ data_source_id }) =>
            queryResponse(
              data_source_id === CLIENTS_DATA_SOURCE_ID
                ? [clientPage()]
                : [taskPage("task-1", { clientIds: ["missing-client"] })],
            ),
        }),
      ).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionRelationError);
  });

  it("rejects a relation to a trashed client", async () => {
    await expect(
      reader(
        fakeClient({
          query: async ({ data_source_id }) =>
            queryResponse(
              data_source_id === CLIENTS_DATA_SOURCE_ID
                ? [clientPage("client-1", { inTrash: true })]
                : [taskPage()],
            ),
        }),
      ).fetchSnapshot(),
    ).rejects.toBeInstanceOf(NotionRelationError);
  });

  it.each([
    [APIErrorCode.Unauthorized, 401, "NOTION_UNAUTHORIZED"],
    [APIErrorCode.RestrictedResource, 403, "NOTION_RESTRICTED_RESOURCE"],
    [APIErrorCode.ObjectNotFound, 404, "NOTION_OBJECT_NOT_FOUND"],
    [APIErrorCode.RateLimited, 429, "NOTION_RATE_LIMITED"],
  ] as const)("maps %s responses to %s", async (apiCode, status, code) => {
    const upstream = apiError(apiCode, status);
    const operation = reader(
      fakeClient({
        databasesRetrieve: async () => {
          throw upstream;
        },
      }),
    ).fetchSnapshot();

    await expect(operation).rejects.toBeInstanceOf(NotionApiError);
    await expect(operation).rejects.toMatchObject({
      code,
      httpStatus: status,
      cause: upstream,
    });
    await expect(operation).rejects.not.toHaveProperty(
      "message",
      "unsafe upstream message",
    );
  });

  it("maps SDK request timeouts without exposing the upstream message", async () => {
    const operation = reader(
      fakeClient({
        databasesRetrieve: async () => {
          throw new RequestTimeoutError("unsafe timeout details");
        },
      }),
    ).fetchSnapshot();

    await expect(operation).rejects.toBeInstanceOf(NotionTimeoutError);
    await expect(operation).rejects.toMatchObject({
      code: "NOTION_TIMEOUT",
      message: "Notion request timed out",
    });
  });

  it("preserves status for an unknown SDK HTTP error response", async () => {
    const operation = reader(
      fakeClient({
        databasesRetrieve: async () => {
          throw new UnknownHTTPResponseError({
            status: 502,
            message: "unsafe upstream message",
            headers: new Headers(),
            rawBodyText: "unsafe raw response",
          });
        },
      }),
    ).fetchSnapshot();

    await expect(operation).rejects.toMatchObject({
      code: "NOTION_API_ERROR",
      httpStatus: 502,
      message: "Notion API returned an invalid error response",
    });
  });

  it("maps network failures to a stable safe error", async () => {
    const operation = reader(
      fakeClient({
        databasesRetrieve: async () => {
          throw new TypeError("unsafe URL with credentials");
        },
      }),
    ).fetchSnapshot();

    await expect(operation).rejects.toMatchObject({
      code: "NOTION_NETWORK_ERROR",
      message: "Notion network request failed",
    });
  });
});
