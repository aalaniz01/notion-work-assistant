export type TaskStatus =
  | "APPROVED"
  | "WAITING_APPROVAL"
  | "CHANGES_REQUESTED"
  | "IN_PROGRESS"
  | "NOT_STARTED";

export interface PriorityFactors {
  deadline: number;
  waitingTime: number;
  estimatedEffort: number;
}

export interface Task {
  id: string;
  clientId: string;
  title: string;
  status: TaskStatus;
  priorityFactors: PriorityFactors;
}

export interface Client {
  id: string;
  name: string;
}
