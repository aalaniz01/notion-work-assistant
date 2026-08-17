import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { externalIdentities, users } from "./schema.js";

export interface ExternalIdentityUserRecord {
  id: string;
  disabledAt: Date | null;
}

export interface ExternalIdentityRepository {
  findUserByIdentity(
    issuer: string,
    subject: string,
  ): Promise<ExternalIdentityUserRecord | null>;
}

export class DrizzleExternalIdentityRepository
  implements ExternalIdentityRepository
{
  constructor(private readonly database: Database) {}

  async findUserByIdentity(
    issuer: string,
    subject: string,
  ): Promise<ExternalIdentityUserRecord | null> {
    const [user] = await this.database.db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(externalIdentities)
      .innerJoin(users, eq(externalIdentities.userId, users.id))
      .where(
        and(
          eq(externalIdentities.issuer, issuer),
          eq(externalIdentities.subject, subject),
        ),
      )
      .limit(1);
    return user ?? null;
  }
}
