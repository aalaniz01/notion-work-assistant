import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema.js";

const DATABASE_OPERATION_TIMEOUT_MS = 2_000;

export interface Database {
  db: PostgresJsDatabase<typeof schema>;
  client: Sql;
  close(): Promise<void>;
}

export function createDatabase(
  databaseUrl: string,
  options: { max?: number } = {},
): Database {
  const client = postgres(databaseUrl, {
    connect_timeout: DATABASE_OPERATION_TIMEOUT_MS / 1_000,
    connection: { statement_timeout: DATABASE_OPERATION_TIMEOUT_MS },
    max: options.max,
    onnotice: () => undefined,
  });

  return {
    db: drizzle(client, { schema }),
    client,
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
