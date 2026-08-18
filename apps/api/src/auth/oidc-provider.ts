import * as openid from "openid-client";

import {
  MAX_EXTERNAL_IDENTITY_COMPONENT_LENGTH,
  type OidcConfiguration,
} from "./oidc-config.js";

export interface OidcAuthorizationRequest {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface ValidatedOidcIdentity {
  issuer: string;
  subject: string;
}

export interface OidcProvider {
  createAuthorizationRequest(): Promise<OidcAuthorizationRequest>;
  validateCallback(
    callbackUrl: URL,
    attempt: { state: string; nonce: string; codeVerifier: string },
  ): Promise<ValidatedOidcIdentity>;
}

export class OidcProviderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("OIDC provider is unavailable", { cause });
    this.name = "OidcProviderUnavailableError";
  }
}

export class OidcCallbackValidationError extends Error {
  constructor(cause?: unknown) {
    super("OIDC callback validation failed", { cause });
    this.name = "OidcCallbackValidationError";
  }
}

export class OidcAccessDeniedError extends Error {
  constructor() {
    super("OIDC authorization was denied");
    this.name = "OidcAccessDeniedError";
  }
}

class OidcProviderTransportError extends Error {
  constructor(cause?: unknown) {
    super("OIDC provider transport failed", { cause });
    this.name = "OidcProviderTransportError";
  }
}

interface OpenIdClientProviderOptions {
  customFetch?: openid.CustomFetch;
}

export class OpenIdClientProvider implements OidcProvider {
  private configurationPromise: Promise<openid.Configuration> | undefined;

  constructor(
    private readonly configuration: OidcConfiguration,
    private readonly options: OpenIdClientProviderOptions = {},
  ) {}

  private readonly providerFetch: openid.CustomFetch = async (input, init) => {
    try {
      const fallbackFetch = fetch as unknown as openid.CustomFetch;
      const response = await (this.options.customFetch ?? fallbackFetch)(
        input,
        init,
      );
      if (!response.ok) throw new OidcProviderTransportError();
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (!contentType?.includes("json")) {
        throw new OidcProviderTransportError();
      }
      await response.clone().json();
      return response;
    } catch (error) {
      if (error instanceof OidcProviderTransportError) throw error;
      if (error instanceof TypeError || error instanceof DOMException) {
        throw new OidcProviderTransportError(error);
      }
      throw error;
    }
  };

  private async getConfiguration(): Promise<openid.Configuration> {
    this.configurationPromise ??= this.discover().catch((error: unknown) => {
      this.configurationPromise = undefined;
      throw error;
    });
    return this.configurationPromise;
  }

  private async discover(): Promise<openid.Configuration> {
    try {
      const clientAuthentication = this.configuration.clientSecret
        ? openid.ClientSecretPost(this.configuration.clientSecret)
        : openid.None();
      const configuration = await openid.discovery(
        this.configuration.issuer,
        this.configuration.clientId,
        undefined,
        clientAuthentication,
        {
          [openid.customFetch]: this.providerFetch,
          execute: [openid.enableNonRepudiationChecks],
        },
      );
      const metadata = configuration.serverMetadata();
      if (metadata.issuer !== this.configuration.issuerIdentifier) {
        throw new OidcCallbackValidationError();
      }
      if (!metadata.supportsPKCE("S256")) {
        throw new OidcProviderUnavailableError();
      }
      const clientAuthenticationMethod = this.configuration.clientSecret
        ? "client_secret_post"
        : "none";
      if (
        !metadata.token_endpoint_auth_methods_supported?.includes(
          clientAuthenticationMethod,
        )
      ) {
        throw new OidcProviderUnavailableError();
      }
      return configuration;
    } catch (error) {
      throw new OidcProviderUnavailableError(error);
    }
  }

  async createAuthorizationRequest(): Promise<OidcAuthorizationRequest> {
    const configuration = await this.getConfiguration();
    const state = openid.randomState();
    const nonce = openid.randomNonce();
    const codeVerifier = openid.randomPKCECodeVerifier();
    const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
    const url = openid.buildAuthorizationUrl(configuration, {
      redirect_uri: this.configuration.callbackUrl.href,
      response_type: "code",
      scope: "openid",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return { url, state, nonce, codeVerifier };
  }

  async validateCallback(
    callbackUrl: URL,
    attempt: { state: string; nonce: string; codeVerifier: string },
  ): Promise<ValidatedOidcIdentity> {
    let configuration: openid.Configuration;
    try {
      configuration = await this.getConfiguration();
    } catch (error) {
      if (error instanceof OidcProviderUnavailableError) throw error;
      throw new OidcProviderUnavailableError(error);
    }

    try {
      const tokens = await openid.authorizationCodeGrant(
        configuration,
        callbackUrl,
        {
          expectedState: attempt.state,
          expectedNonce: attempt.nonce,
          pkceCodeVerifier: attempt.codeVerifier,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      return this.validateIdentityClaims(claims);
    } catch (error) {
      if (
        error instanceof openid.AuthorizationResponseError &&
        error.error === "access_denied"
      ) {
        throw new OidcAccessDeniedError();
      }
      if (error instanceof OidcCallbackValidationError) throw error;
      if (this.isProviderAvailabilityFailure(error)) {
        throw new OidcProviderUnavailableError(error);
      }
      if (
        error instanceof openid.ClientError ||
        error instanceof openid.AuthorizationResponseError ||
        error instanceof openid.ResponseBodyError ||
        error instanceof openid.WWWAuthenticateChallengeError
      ) {
        throw new OidcCallbackValidationError(error);
      }
      throw new OidcProviderUnavailableError(error);
    }
  }

  private validateIdentityClaims(claims: unknown): ValidatedOidcIdentity {
    if (!claims || typeof claims !== "object") {
      throw new OidcCallbackValidationError();
    }
    const values = claims as Record<string, unknown>;
    if (
      typeof values.iss !== "string" ||
      values.iss.length === 0 ||
      values.iss.length > MAX_EXTERNAL_IDENTITY_COMPONENT_LENGTH ||
      values.iss !== this.configuration.issuerIdentifier ||
      typeof values.sub !== "string" ||
      values.sub.length === 0 ||
      values.sub.length > MAX_EXTERNAL_IDENTITY_COMPONENT_LENGTH ||
      values.sub.trim().length === 0 ||
      !this.hasAudience(values.aud) ||
      typeof values.exp !== "number" ||
      !Number.isFinite(values.exp) ||
      typeof values.iat !== "number" ||
      !Number.isFinite(values.iat)
    ) {
      throw new OidcCallbackValidationError();
    }
    return { issuer: values.iss, subject: values.sub };
  }

  private hasAudience(audience: unknown): boolean {
    if (typeof audience === "string") {
      return audience === this.configuration.clientId;
    }
    return (
      Array.isArray(audience) &&
      audience.length > 0 &&
      audience.every((value) => typeof value === "string") &&
      audience.includes(this.configuration.clientId)
    );
  }

  private isProviderAvailabilityFailure(error: unknown): boolean {
    if (
      error instanceof OidcProviderTransportError ||
      error instanceof TypeError
    ) {
      return true;
    }
    if (
      error instanceof Error &&
      this.isProviderAvailabilityFailure(error.cause)
    ) {
      return true;
    }
    if (!(error instanceof openid.ClientError)) return false;
    return new Set([
      "OAUTH_TIMEOUT",
      "OAUTH_ABORT",
      "OAUTH_RESPONSE_IS_NOT_CONFORM",
      "OAUTH_RESPONSE_IS_NOT_JSON",
      "OAUTH_KEY_SELECTION_FAILED",
    ]).has(typeof error.code === "string" ? error.code : "");
  }
}
