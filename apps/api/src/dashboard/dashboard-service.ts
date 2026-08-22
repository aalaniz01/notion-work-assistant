import type {
  Client,
  Dashboard,
  DashboardRecommendation,
  PrioritySettings,
  Task,
} from "@notion-work-assistant/domain";
import type { PrioritySettingsRepository } from "@notion-work-assistant/db";
import type {
  NotionReader,
  NotionSnapshot,
  NotionTask,
} from "@notion-work-assistant/notion";
import { NotionAdapterError } from "@notion-work-assistant/notion";
import {
  calculatePriority,
  DEFAULT_PRIORITY_WEIGHTS,
  type PriorityWeights,
} from "@notion-work-assistant/priority-engine";

import { NotionUnavailableError } from "./notion-unavailable.js";

export interface DashboardService {
  loadDashboard(workspaceId: string): Promise<Dashboard>;
}

const DAY_MS = 86_400_000;
const ESTIMATED_EFFORT_FACTOR = 50;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDay(date: Date): number {
  return (
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
    DAY_MS
  );
}

function dateDayNumber(value: string): number {
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly) {
    return (
      Date.UTC(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      ) / DAY_MS
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError("Task date is not a valid date");
  }
  return calendarDay(parsed);
}

function deadlineFactor(dueDate: string | null, now: Date): number {
  if (dueDate === null) return 0;
  const daysRemaining = dateDayNumber(dueDate) - calendarDay(now);
  if (daysRemaining <= 0) return 100;
  return Math.min(100, Math.max(0, 100 - daysRemaining * 10));
}

function waitingTimeFactor(createdAt: string, now: Date): number {
  const daysOld = calendarDay(now) - dateDayNumber(createdAt);
  return Math.min(100, Math.max(0, daysOld * 10));
}

function toDomainTask(task: NotionTask, now: Date): Task {
  return {
    id: task.id,
    clientId: task.clientId,
    title: task.title,
    status: task.status,
    priorityFactors: {
      deadline: deadlineFactor(task.dueDate, now),
      waitingTime: waitingTimeFactor(task.createdAt, now),
      estimatedEffort: ESTIMATED_EFFORT_FACTOR,
    },
  };
}

function weightsFromSettings(
  settings: PrioritySettings | null,
): PriorityWeights {
  if (settings === null) return DEFAULT_PRIORITY_WEIGHTS;
  return {
    deadlineWeight: settings.deadlineWeight,
    waitingTimeWeight: settings.waitingTimeWeight,
    estimatedEffortWeight: settings.estimatedEffortWeight,
  };
}

function buildDashboard(
  snapshot: NotionSnapshot,
  weights: PriorityWeights,
  now: Date,
): Dashboard {
  const clients: Client[] = snapshot.clients.map(({ id, name }) => ({
    id,
    name,
  }));
  const recommendations: DashboardRecommendation[] = [];

  for (const notionTask of snapshot.tasks) {
    const task = toDomainTask(notionTask, now);
    const result = calculatePriority(task, weights);
    if (!result.eligible) continue;

    recommendations.push({
      task,
      priority: {
        recommendationScore: result.recommendationScore,
        priorityLevel: result.priorityLevel,
      },
    });
  }

  recommendations.sort(
    (left, right) =>
      right.priority.recommendationScore - left.priority.recommendationScore ||
      left.task.id.localeCompare(right.task.id),
  );

  return { clients, recommendations };
}

export class NotionDashboardService implements DashboardService {
  constructor(
    private readonly reader: NotionReader,
    private readonly prioritySettings: PrioritySettingsRepository,
    private readonly now: () => Date,
  ) {}

  async loadDashboard(workspaceId: string): Promise<Dashboard> {
    let snapshot: NotionSnapshot;
    try {
      snapshot = await this.reader.fetchSnapshot();
    } catch (error) {
      if (error instanceof NotionAdapterError) {
        throw new NotionUnavailableError(error.code);
      }
      throw error;
    }

    const settings = await this.prioritySettings.findByWorkspaceId(workspaceId);
    return buildDashboard(snapshot, weightsFromSettings(settings), this.now());
  }
}
