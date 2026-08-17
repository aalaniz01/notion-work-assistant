import { and, eq, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { externalIdentities, users, workspaceMemberships } from "./schema.js";

export interface ProvisionIdentityInput {
  issuer: string;
  subject: string;
  workspaceId: string;
  createdAt: Date;
}

export interface IdentityProvisioningRepository {
  provisionIdentityAndMembership(
    input: ProvisionIdentityInput,
  ): Promise<{ userId: string }>;
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

  async provisionIdentityAndMembership(
    input: ProvisionIdentityInput,
  ): Promise<{ userId: string }> {
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
        .select({ userId: externalIdentities.userId })
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.issuer, input.issuer),
            eq(externalIdentities.subject, input.subject),
          ),
        )
        .limit(1);

      let userId = existingIdentity?.userId;
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

      return { userId };
    });
  }
}
