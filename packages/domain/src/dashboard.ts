import type { Client, Task } from "./task.js";
import type { PriorityLevel } from "./priority.js";

export interface DashboardRecommendation {
  task: Task;
  priority: {
    recommendationScore: number;
    priorityLevel: PriorityLevel;
  };
}

export interface Dashboard {
  clients: Client[];
  recommendations: DashboardRecommendation[];
}
