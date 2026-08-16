export interface Workspace {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrioritySettings {
  workspaceId: string;
  deadlineWeight: number;
  waitingTimeWeight: number;
  estimatedEffortWeight: number;
  createdAt: Date;
  updatedAt: Date;
}
