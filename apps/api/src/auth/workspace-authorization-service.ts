import type { WorkspaceMembershipRepository } from "@notion-work-assistant/db";

import { AuthenticationUnavailableError } from "./errors.js";
import type {
  AuthorizedWorkspace,
  WorkspaceAuthorizationService,
} from "./types.js";

export class ApplicationWorkspaceAuthorizationService
  implements WorkspaceAuthorizationService
{
  constructor(private readonly repository: WorkspaceMembershipRepository) {}

  async listAuthorizedWorkspaces(
    userId: string,
  ): Promise<AuthorizedWorkspace[]> {
    try {
      return await this.repository.listActiveForUser(userId);
    } catch (error) {
      throw new AuthenticationUnavailableError(error);
    }
  }

  async hasAccess(userId: string, workspaceId: string): Promise<boolean> {
    try {
      return await this.repository.hasActiveMembership(userId, workspaceId);
    } catch (error) {
      throw new AuthenticationUnavailableError(error);
    }
  }
}
