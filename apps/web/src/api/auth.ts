import { requestJson } from "./request";

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
