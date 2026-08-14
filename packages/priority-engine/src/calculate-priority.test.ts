import type { Task, TaskStatus } from "@notion-work-assistant/domain";
import { describe, expect, it } from "vitest";

import { calculatePriority } from "./calculate-priority.js";

function makeTask(
  status: TaskStatus = "NOT_STARTED",
  deadline = 0,
  waitingTime = 0,
  estimatedEffort = 0,
): Task {
  return {
    id: "task-1",
    clientId: "client-1",
    title: "Test task",
    status,
    priorityFactors: { deadline, waitingTime, estimatedEffort },
  };
}

function expectScore(
  task: Task,
  score: number,
  level: "LOW" | "MEDIUM" | "HIGH",
) {
  expect(calculatePriority(task)).toEqual({
    taskId: task.id,
    eligible: true,
    recommendationScore: score,
    priorityLevel: level,
  });
}

describe("calculatePriority", () => {
  it.each(["APPROVED", "WAITING_APPROVAL"] as const)(
    "excludes %s tasks",
    (status) => {
      expect(calculatePriority(makeTask(status))).toEqual({
        taskId: "task-1",
        eligible: false,
        reason: "STATUS_EXCLUDED",
      });
    },
  );

  it("weights normalized factors at 50, 40, and 10 percent", () => {
    expectScore(makeTask("NOT_STARTED", 100, 0, 0), 50, "MEDIUM");
    expectScore(makeTask("NOT_STARTED", 0, 100, 0), 40, "MEDIUM");
    expectScore(makeTask("NOT_STARTED", 0, 0, 100), 10, "LOW");
  });

  it("calculates a mixed score with no NOT_STARTED bonus", () => {
    expectScore(makeTask("NOT_STARTED", 80, 50, 20), 62, "MEDIUM");
  });

  it("adds the CHANGES_REQUESTED bonus", () => {
    expectScore(makeTask("CHANGES_REQUESTED", 80, 50, 20), 72, "HIGH");
  });

  it("adds the IN_PROGRESS bonus", () => {
    expectScore(makeTask("IN_PROGRESS", 80, 50, 20), 67, "MEDIUM");
  });

  it("caps a score with a bonus at 100", () => {
    expectScore(makeTask("CHANGES_REQUESTED", 100, 100, 100), 100, "HIGH");
  });

  it.each([
    [0, "LOW"],
    [39, "LOW"],
    [40, "MEDIUM"],
    [69, "MEDIUM"],
    [70, "HIGH"],
    [100, "HIGH"],
  ] as const)("classifies score %i as %s", (score, level) => {
    expectScore(makeTask("NOT_STARTED", score, score, score), score, level);
  });

  it("rounds the final score with Math.round", () => {
    expectScore(makeTask("NOT_STARTED", 1, 0, 0), 1, "LOW");
  });

  it.each([
    -1,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects an invalid factor value of %s", (value) => {
    expect(() => calculatePriority(makeTask("NOT_STARTED", value))).toThrow(
      RangeError,
    );
  });

  it("is deterministic and does not mutate its input", () => {
    const task = makeTask("IN_PROGRESS", 60, 40, 20);
    const snapshot = structuredClone(task);

    expect(calculatePriority(task)).toEqual(calculatePriority(task));
    expect(task).toEqual(snapshot);
  });
});
