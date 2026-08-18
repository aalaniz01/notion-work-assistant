import {
  createDatabase,
  DrizzleIdentityProvisioningRepository,
} from "@notion-work-assistant/db";

import { parseOidcConfiguration } from "./auth/oidc-config.js";
import {
  parseOperatorProvisioningArguments,
  provisionOperatorIdentity,
} from "./auth/operator-provisioning.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const oidc = parseOidcConfiguration(process.env);
  if (!databaseUrl || !oidc) {
    throw new Error("Provisioning configuration is unavailable");
  }

  const database = createDatabase(databaseUrl);
  try {
    await provisionOperatorIdentity({
      configuredIssuer: oidc.issuerIdentifier,
      input: parseOperatorProvisioningArguments(process.argv.slice(2)),
      repository: new DrizzleIdentityProvisioningRepository(database),
    });
  } finally {
    await database.close();
  }
}

try {
  await main();
  process.stdout.write("OIDC identity provisioned\n");
} catch {
  process.stderr.write("OIDC identity provisioning failed\n");
  process.exitCode = 1;
}
