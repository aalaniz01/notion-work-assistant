import { eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { sessions, users } from "./schema.js";

export interface UserAuthenticationRecord {
  id: string;
  disabledAt: Date | null;
}

export interface SessionAuthenticationRecord {
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  disabledAt: Date | null;
}

export interface NewSessionRecord {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SessionRepository {
  findUserById(userId: string): Promise<UserAuthenticationRecord | null>;
  create(session: NewSessionRecord): Promise<void>;
  findByTokenHash(
    tokenHash: string,
  ): Promise<SessionAuthenticationRecord | null>;
  revoke(tokenHash: string, revokedAt: Date): Promise<void>;
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  async findUserById(userId: string): Promise<UserAuthenticationRecord | null> {
    const [user] = await this.database.db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async create(session: NewSessionRecord): Promise<void> {
    await this.database.db.insert(sessions).values(session);
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<SessionAuthenticationRecord | null> {
    const [session] = await this.database.db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        disabledAt: users.disabledAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return session ?? null;
  }

  async revoke(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt })
      .where(eq(sessions.tokenHash, tokenHash));
  }
}
