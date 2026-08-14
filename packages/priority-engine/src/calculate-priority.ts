import type {
  PriorityLevel,
  PriorityResult,
  Task,
} from "@notion-work-assistant/domain";

const STATUS_BONUSES = {
  CHANGES_REQUESTED: 10,
  IN_PROGRESS: 5,
  NOT_STARTED: 0,
} as const;

function validateFactor(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be a finite number from 0 to 100`);
  }
}

function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export function calculatePriority(task: Task): PriorityResult {
  if (task.status === "APPROVED" || task.status === "WAITING_APPROVAL") {
    return {
      taskId: task.id,
      eligible: false,
      reason: "STATUS_EXCLUDED",
    };
  }

  const { deadline, waitingTime, estimatedEffort } = task.priorityFactors;
  validateFactor("deadline", deadline);
  validateFactor("waitingTime", waitingTime);
  validateFactor("estimatedEffort", estimatedEffort);

  const baseScore = deadline * 0.5 + waitingTime * 0.4 + estimatedEffort * 0.1;
  const recommendationScore = Math.round(
    Math.min(100, baseScore + STATUS_BONUSES[task.status]),
  );

  return {
    taskId: task.id,
    eligible: true,
    recommendationScore,
    priorityLevel: getPriorityLevel(recommendationScore),
  };
}
