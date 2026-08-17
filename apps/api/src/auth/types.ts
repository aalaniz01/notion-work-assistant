export interface AuthenticatedPrincipal {
  userId: string;
}

export interface AuthorizedWorkspace {
  id: string;
  name: string;
}

export interface RequestSessionService {
  authenticate(
    rawToken: string | undefined,
  ): Promise<AuthenticatedPrincipal | null>;
}

export interface WorkspaceAuthorizationService {
  listAuthorizedWorkspaces(userId: string): Promise<AuthorizedWorkspace[]>;
  hasAccess(userId: string, workspaceId: string): Promise<boolean>;
}
