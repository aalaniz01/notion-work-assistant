import type { ExternalIdentityRepository } from "@notion-work-assistant/db";

import {
  AuthenticationUnavailableError,
  SessionCreationError,
} from "./errors.js";
import type { OidcProvider, ValidatedOidcIdentity } from "./oidc-provider.js";
import type { CreatedSession, SessionService } from "./session-service.js";

export class OidcIdentityNotAuthorizedError extends Error {
  constructor() {
    super("OIDC identity is not authorized");
    this.name = "OidcIdentityNotAuthorizedError";
  }
}

export class OidcLoginService {
  constructor(
    readonly provider: OidcProvider,
    private readonly identities: ExternalIdentityRepository,
    private readonly sessions: SessionService,
  ) {}

  async createSessionForIdentity(
    identity: ValidatedOidcIdentity,
  ): Promise<CreatedSession> {
    let user;
    try {
      user = await this.identities.findUserByIdentity(
        identity.issuer,
        identity.subject,
      );
    } catch (error) {
      throw new AuthenticationUnavailableError(error);
    }
    if (!user || user.disabledAt) throw new OidcIdentityNotAuthorizedError();

    try {
      return await this.sessions.create(user.id);
    } catch (error) {
      if (error instanceof SessionCreationError) {
        throw new OidcIdentityNotAuthorizedError();
      }
      throw error;
    }
  }
}
