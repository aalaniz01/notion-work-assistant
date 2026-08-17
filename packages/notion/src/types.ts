import type { TaskStatus } from "@notion-work-assistant/domain";

export interface NotionClient {
  id: string;
  name: string;
}

export interface NotionTask {
  id: string;
  title: string;
  clientId: string;
  taskType: string | null;
  dueDate: string | null;
  status: TaskStatus;
  priority: string | null;
}

export interface NotionSnapshot {
  clients: NotionClient[];
  tasks: NotionTask[];
  skippedTasks: {
    missingClientRelation: number;
  };
}

export interface NotionReader {
  validate(): Promise<void>;
  fetchSnapshot(): Promise<NotionSnapshot>;
}
