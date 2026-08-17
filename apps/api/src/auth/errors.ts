export class AuthenticationUnavailableError extends Error {
  readonly code = "AUTH_UNAVAILABLE";

  constructor(cause?: unknown) {
    super("Authentication storage is unavailable", { cause });
    this.name = "AuthenticationUnavailableError";
  }
}

export class SessionCreationError extends Error {
  readonly code = "SESSION_CREATION_FAILED";

  constructor() {
    super("Session cannot be created for this user");
    this.name = "SessionCreationError";
  }
}
