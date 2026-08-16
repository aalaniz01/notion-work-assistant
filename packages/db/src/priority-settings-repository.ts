import type { PrioritySettings } from "@notion-work-assistant/domain";
import { eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { prioritySettings } from "./schema.js";

export interface PrioritySettingsRepository {
  findByWorkspaceId(workspaceId: string): Promise<PrioritySettings | null>;
}

export class DrizzlePrioritySettingsRepository
  implements PrioritySettingsRepository
{
  constructor(private readonly database: Database) {}

  async findByWorkspaceId(
    workspaceId: string,
  ): Promise<PrioritySettings | null> {
    const [settings] = await this.database.db
      .select()
      .from(prioritySettings)
      .where(eq(prioritySettings.workspaceId, workspaceId))
      .limit(1);

    return settings ?? null;
  }
}
