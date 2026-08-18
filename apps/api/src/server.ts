import {
  createDatabase,
  createDatabaseReadinessCheck,
  DrizzleExternalIdentityRepository,
  DrizzleSessionRepository,
  DrizzleWorkspaceMembershipRepository,
  type Database,
} from "@notion-work-assistant/db";

import {
  parseApplicationSessionConfiguration,
  parseOidcConfiguration,
} from "./auth/oidc-config.js";
import { OidcLoginService } from "./auth/oidc-login-service.js";
import { OpenIdClientProvider } from "./auth/oidc-provider.js";
import { OidcTransientStateService } from "./auth/oidc-transient-state.js";
import { ApplicationSessionService } from "./auth/session-service.js";
import { ApplicationWorkspaceAuthorizationService } from "./auth/workspace-authorization-service.js";
import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
const database: Database | undefined = databaseUrl
  ? createDatabase(databaseUrl)
  : undefined;
const checkDatabaseReadiness = database
  ? createDatabaseReadinessCheck(database)
  : undefined;
const authentication = database
  ? new ApplicationSessionService(new DrizzleSessionRepository(database))
  : undefined;
const sessionCookies = parseApplicationSessionConfiguration(process.env);
const oidcConfiguration = parseOidcConfiguration(process.env);
const oidc =
  database && authentication && oidcConfiguration
    ? {
        applicationOrigin: oidcConfiguration.applicationOrigin,
        callbackUrl: oidcConfiguration.callbackUrl,
        login: new OidcLoginService(
          new OpenIdClientProvider(oidcConfiguration),
          new DrizzleExternalIdentityRepository(database),
          authentication,
        ),
        secureCookies: oidcConfiguration.secureCookies,
        transientState: new OidcTransientStateService(
          oidcConfiguration.transientSecret,
        ),
      }
    : undefined;
const workspaceAuthorization = database
  ? new ApplicationWorkspaceAuthorizationService(
      new DrizzleWorkspaceMembershipRepository(database),
    )
  : undefined;
const app = buildApp({
  authentication,
  closeDatabase: database ? () => database.close() : undefined,
  oidc,
  readiness: checkDatabaseReadiness
    ? { isReady: checkDatabaseReadiness }
    : undefined,
  sessions: authentication,
  sessionCookies,
  workspaceAuthorization,
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
