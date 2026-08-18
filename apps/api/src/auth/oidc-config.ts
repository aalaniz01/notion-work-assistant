const REQUIRED_OIDC_VARIABLES = [
  "APPLICATION_ORIGIN",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_TRANSIENT_SECRET",
] as const;

const ALL_OIDC_VARIABLES = [
  ...REQUIRED_OIDC_VARIABLES,
  "OIDC_CLIENT_SECRET",
] as const;

const TRANSIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_EXTERNAL_IDENTITY_COMPONENT_LENGTH = 255;

export interface ApplicationSessionConfiguration {
  applicationOrigin: URL;
  secureCookies: boolean;
}

export interface OidcConfiguration {
  applicationOrigin: ApplicationSessionConfiguration["applicationOrigin"];
  callbackUrl: URL;
  clientId: string;
  clientSecret?: string;
  issuer: URL;
  issuerIdentifier: string;
  secureCookies: boolean;
  transientSecret: Uint8Array;
}

export class OidcConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcConfigurationError";
  }
}

function configuredValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = environment[name];
  return value === undefined ? undefined : value.trim();
}

function parseApplicationOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcConfigurationError("APPLICATION_ORIGIN must be a valid URL");
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new OidcConfigurationError(
      "APPLICATION_ORIGIN must contain only scheme, host, and optional port",
    );
  }

  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new OidcConfigurationError(
      "APPLICATION_ORIGIN must use HTTPS except on loopback",
    );
  }

  return new URL(url.origin);
}

export function parseApplicationSessionConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ApplicationSessionConfiguration | undefined {
  const configuredOrigin = environment.APPLICATION_ORIGIN;
  if (configuredOrigin === undefined) return undefined;
  const applicationOrigin = parseApplicationOrigin(configuredOrigin.trim());
  return {
    applicationOrigin,
    secureCookies: applicationOrigin.protocol === "https:",
  };
}

function parseIssuer(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcConfigurationError("OIDC_ISSUER must be a valid URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new OidcConfigurationError(
      "OIDC_ISSUER must be an HTTPS URL without credentials, query, or fragment",
    );
  }
  if (value.length > MAX_EXTERNAL_IDENTITY_COMPONENT_LENGTH) {
    throw new OidcConfigurationError(
      "OIDC_ISSUER exceeds the supported identity length",
    );
  }

  return url;
}

function parseTransientSecret(value: string): Uint8Array {
  if (!TRANSIENT_SECRET_PATTERN.test(value)) {
    throw new OidcConfigurationError(
      "OIDC_TRANSIENT_SECRET must be 32 bytes encoded as unpadded base64url",
    );
  }

  const secret = Buffer.from(value, "base64url");
  if (secret.length !== 32 || secret.toString("base64url") !== value) {
    throw new OidcConfigurationError(
      "OIDC_TRANSIENT_SECRET must be 32 bytes encoded as unpadded base64url",
    );
  }
  return new Uint8Array(secret);
}

export function parseOidcConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): OidcConfiguration | undefined {
  const sessionConfiguration =
    parseApplicationSessionConfiguration(environment);
  const hasOidcValue = ALL_OIDC_VARIABLES.some(
    (name) => name !== "APPLICATION_ORIGIN" && environment[name] !== undefined,
  );
  if (!hasOidcValue) return undefined;

  for (const name of REQUIRED_OIDC_VARIABLES) {
    if (!configuredValue(environment, name)) {
      throw new OidcConfigurationError(
        `OIDC configuration is incomplete: ${name} is required`,
      );
    }
  }
  if (!sessionConfiguration) {
    throw new OidcConfigurationError(
      "OIDC configuration is incomplete: APPLICATION_ORIGIN is required",
    );
  }

  const applicationOrigin = sessionConfiguration.applicationOrigin;
  const issuerIdentifier = configuredValue(environment, "OIDC_ISSUER")!;
  const issuer = parseIssuer(issuerIdentifier);
  const clientId = configuredValue(environment, "OIDC_CLIENT_ID")!;
  const transientSecret = parseTransientSecret(
    configuredValue(environment, "OIDC_TRANSIENT_SECRET")!,
  );
  const configuredClientSecret = environment.OIDC_CLIENT_SECRET;
  if (configuredClientSecret !== undefined && !configuredClientSecret.trim()) {
    throw new OidcConfigurationError(
      "OIDC_CLIENT_SECRET must be omitted for a public client or set to a non-empty value",
    );
  }
  const clientSecret = configuredClientSecret?.trim();

  return {
    applicationOrigin,
    callbackUrl: new URL("/api/auth/callback", applicationOrigin),
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    issuer,
    issuerIdentifier,
    secureCookies: sessionConfiguration.secureCookies,
    transientSecret,
  };
}
