import {
  Client,
  iterateAllDataSourceRows,
  LogLevel,
  type FullDataSourceQueryArgs,
  type GetDatabaseParameters,
  type GetDatabaseResponse,
  type GetDataSourceParameters,
  type GetDataSourceResponse,
  type QueryDataSourceParameters,
  type QueryDataSourceResponse,
} from "@notionhq/client";

export const NOTION_API_VERSION = "2026-03-11";
export const NOTION_REQUEST_TIMEOUT_MS = 10_000;
export const NOTION_MAX_RETRIES = 2;
const NOTION_INITIAL_RETRY_DELAY_MS = 1_000;
const NOTION_MAX_RETRY_DELAY_MS = 60_000;

export interface NotionReadClient {
  databases: {
    retrieve(args: GetDatabaseParameters): Promise<GetDatabaseResponse>;
  };
  dataSources: {
    retrieve(args: GetDataSourceParameters): Promise<GetDataSourceResponse>;
    query(args: QueryDataSourceParameters): Promise<QueryDataSourceResponse>;
  };
}

interface SdkClientOptions {
  auth: string;
  notionVersion: string;
  timeoutMs: number;
  logLevel: LogLevel;
  logger: () => void;
  retry: {
    maxRetries: number;
    initialRetryDelayMs: number;
    maxRetryDelayMs: number;
  };
}

type SdkClientFactory = (options: SdkClientOptions) => NotionReadClient;

export function createNotionReadClient(
  token: string,
  factory: SdkClientFactory = (options) => new Client(options),
): NotionReadClient {
  const client = factory({
    auth: token,
    notionVersion: NOTION_API_VERSION,
    timeoutMs: NOTION_REQUEST_TIMEOUT_MS,
    logLevel: LogLevel.ERROR,
    logger: () => undefined,
    retry: {
      maxRetries: NOTION_MAX_RETRIES,
      initialRetryDelayMs: NOTION_INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: NOTION_MAX_RETRY_DELAY_MS,
    },
  });

  return {
    databases: {
      retrieve: (args) => client.databases.retrieve(args),
    },
    dataSources: {
      retrieve: (args) => client.dataSources.retrieve(args),
      query: (args) => client.dataSources.query(args),
    },
  };
}

export function iterateNotionDataSourceRows(
  client: NotionReadClient,
  args: FullDataSourceQueryArgs,
): ReturnType<typeof iterateAllDataSourceRows> {
  // The official helper only invokes dataSources.query. Keep that SDK detail
  // isolated here so the reader never receives write-capable SDK methods.
  return iterateAllDataSourceRows(client as Client, args);
}
