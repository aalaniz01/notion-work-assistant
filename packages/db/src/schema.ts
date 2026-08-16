import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "workspaces_name_length_check",
      sql`char_length(btrim(${table.name})) between 1 and 200`,
    ),
  ],
);

export const prioritySettings = pgTable(
  "priority_settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id),
    deadlineWeight: integer("deadline_weight").notNull().default(50),
    waitingTimeWeight: integer("waiting_time_weight").notNull().default(40),
    estimatedEffortWeight: integer("estimated_effort_weight")
      .notNull()
      .default(10),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "priority_settings_valid_weights_check",
      sql`${table.deadlineWeight} between 0 and 100
        and ${table.waitingTimeWeight} between 0 and 100
        and ${table.estimatedEffortWeight} between 0 and 100
        and ${table.deadlineWeight} + ${table.waitingTimeWeight} + ${table.estimatedEffortWeight} = 100`,
    ),
  ],
);
