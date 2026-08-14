export type PriorityLevel = "LOW" | "MEDIUM" | "HIGH";

export type PriorityResult =
  | {
      taskId: string;
      eligible: false;
      reason: "STATUS_EXCLUDED";
    }
  | {
      taskId: string;
      eligible: true;
      recommendationScore: number;
      priorityLevel: PriorityLevel;
    };
