import { and, eq, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  externalIdentities,
  users,
  workspaceMemberships,
  workspaces,
} from "./schema.js";

export interface ProvisionIdentityInput {
  issuer: string;
  subject: string;
  workspaceId: string;
  createdAt: Date;
}

export interface IdentityProvisioningRepository {
  workspaceExists(workspaceId: string): Promise<boolean>;
  provisionIdentityAndMembership(
    input: ProvisionIdentityInput,
  ): Promise<{ userId: string; membershipActive: boolean }>;
}

export class DisabledIdentityProvisioningError extends Error {
  constructor() {
    super("Cannot provision a disabled identity");
    this.name = "DisabledIdentityProvisioningError";
  }
}

export function encodeIdentityAdvisoryLockInput(
  issuer: string,
  subject: string,
): string {
  return `${issuer.length}:${issuer}${subject.length}:${subject}`;
}

export class DrizzleIdentityProvisioningRepository
  implements IdentityProvisioningRepository
{
  constructor(private readonly database: Database) {}

  async workspaceExists(workspaceId: string): Promise<boolean> {
    const [workspace] = await this.database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return workspace !== undefined;
  }

  async provisionIdentityAndMembership(
    input: ProvisionIdentityInput,
  ): Promise<{ userId: string; membershipActive: boolean }> {
    return this.database.db.transaction(async (transaction) => {
      const lockInput = encodeIdentityAdvisoryLockInput(
        input.issuer,
        input.subject,
      );
      // A theoretical 64-bit hash collision only serializes unrelated requests;
      // identity lookup and authorization still use the original values.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockInput}, 0))`,
      );
      const [existingIdentity] = await transaction
        .select({
          userId: externalIdentities.userId,
          disabledAt: users.disabledAt,
        })
        .from(externalIdentities)
        .innerJoin(users, eq(externalIdentities.userId, users.id))
        .where(
          and(
            eq(externalIdentities.issuer, input.issuer),
            eq(externalIdentities.subject, input.subject),
          ),
        )
        .limit(1);

      let userId = existingIdentity?.userId;
      if (existingIdentity?.disabledAt) {
        throw new DisabledIdentityProvisioningError();
      }
      if (!userId) {
        const [user] = await transaction
          .insert(users)
          .values({ createdAt: input.createdAt, updatedAt: input.createdAt })
          .returning({ id: users.id });
        if (!user) throw new Error("Failed to create provisioned user");
        userId = user.id;
        await transaction.insert(externalIdentities).values({
          userId,
          issuer: input.issuer,
          subject: input.subject,
          createdAt: input.createdAt,
        });
      }

      await transaction
        .insert(workspaceMemberships)
        .values({
          userId,
          workspaceId: input.workspaceId,
          createdAt: input.createdAt,
        })
        .onConflictDoNothing({
          target: [
            workspaceMemberships.userId,
            workspaceMemberships.workspaceId,
          ],
        });

      const [membership] = await transaction
        .select({ revokedAt: workspaceMemberships.revokedAt })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!membership) throw new Error("Failed to create workspace membership");

      return { userId, membershipActive: membership.revokedAt === null };
    });
  }
}
