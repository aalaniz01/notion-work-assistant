import { ApiError, requestJson } from "./request";

export interface AuthorizedWorkspace {
  id: string;
  name: string;
}

export type SessionState =
  | { authenticated: false }
  | { authenticated: true; workspaces: AuthorizedWorkspace[] };

export async function getSession(signal?: AbortSignal): Promise<SessionState> {
  const value = await requestJson<unknown>("/api/auth/session", signal);
  if (
    !value ||
    typeof value !== "object" ||
    !("authenticated" in value) ||
    typeof value.authenticated !== "boolean"
  ) {
    throw new Error("Invalid session response");
  }
  if (!value.authenticated) return { authenticated: false };
  if (
    !("workspaces" in value) ||
    !Array.isArray(value.workspaces) ||
    !value.workspaces.every(
      (workspace) =>
        workspace &&
        typeof workspace === "object" &&
        "id" in workspace &&
        typeof workspace.id === "string" &&
        "name" in workspace &&
        typeof workspace.name === "string",
    )
  ) {
    throw new Error("Invalid session response");
  }
  return {
    authenticated: true,
    workspaces: value.workspaces as AuthorizedWorkspace[],
  };
}

export type LogoutResult = "confirmed" | "revocation-unconfirmed";

export async function logout(): Promise<LogoutResult> {
  let response: Response;
  try {
    response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new LogoutTransportError(error);
  }
  if (response.status === 204) return "confirmed";
  if (response.status === 503) {
    const body: unknown = await response.json().catch(() => undefined);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "code" in body.error &&
      body.error.code === "AUTH_UNAVAILABLE"
    ) {
      return "revocation-unconfirmed";
    }
  }
  throw new ApiError(response.status);
}

export class LogoutTransportError extends Error {
  constructor(cause: unknown) {
    super("Logout transport failed", { cause });
    this.name = "LogoutTransportError";
  }
}
