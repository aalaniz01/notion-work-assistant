import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "./client.js";
import { workspaceMemberships, workspaces } from "./schema.js";

export interface AuthorizedWorkspaceRecord {
  id: string;
  name: string;
}

export interface WorkspaceMembershipRepository {
  listActiveForUser(userId: string): Promise<AuthorizedWorkspaceRecord[]>;
  hasActiveMembership(userId: string, workspaceId: string): Promise<boolean>;
}

export class DrizzleWorkspaceMembershipRepository
  implements WorkspaceMembershipRepository
{
  constructor(private readonly database: Database) {}

  async listActiveForUser(
    userId: string,
  ): Promise<AuthorizedWorkspaceRecord[]> {
    return this.database.db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaceMemberships)
      .innerJoin(
        workspaces,
        eq(workspaceMemberships.workspaceId, workspaces.id),
      )
      .where(
        and(
          eq(workspaceMemberships.userId, userId),
          isNull(workspaceMemberships.revokedAt),
        ),
      )
      .orderBy(workspaces.id);
  }

  async hasActiveMembership(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const [membership] = await this.database.db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.workspaceId, workspaceId),
          isNull(workspaceMemberships.revokedAt),
        ),
      )
      .limit(1);
    return membership !== undefined;
  }
}
