import {
  createDatabase,
  createDatabaseReadinessCheck,
  type Database,
} from "@notion-work-assistant/db";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
const database: Database | undefined = databaseUrl
  ? createDatabase(databaseUrl)
  : undefined;
const checkDatabaseReadiness = database
  ? createDatabaseReadinessCheck(database)
  : undefined;
const app = buildApp({
  closeDatabase: database ? () => database.close() : undefined,
  readiness: checkDatabaseReadiness
    ? { isReady: checkDatabaseReadiness }
    : undefined,
});
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new RangeError("PORT must be an integer from 0 to 65535");
}

async function shutdown(): Promise<void> {
  try {
    await app.close();
  } catch {
    process.stderr.write("API shutdown failed\n");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  const address = await app.listen({ host: "127.0.0.1", port });
  process.stdout.write(`API_LISTENING=${address}\n`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
