import type { Client, Task } from "@notion-work-assistant/domain";

export const clients: Client[] = [
  { id: "client-1", name: "Northstar Studio" },
  { id: "client-2", name: "Fieldwork Labs" },
];

export const tasks: Task[] = [
  {
    id: "task-1",
    clientId: "client-1",
    title: "Revise campaign direction",
    status: "CHANGES_REQUESTED",
    priorityFactors: { deadline: 80, waitingTime: 50, estimatedEffort: 20 },
  },
  {
    id: "task-2",
    clientId: "client-2",
    title: "Prepare research summary",
    status: "IN_PROGRESS",
    priorityFactors: { deadline: 60, waitingTime: 60, estimatedEffort: 30 },
  },
  {
    id: "task-3",
    clientId: "client-1",
    title: "Archive approved brief",
    status: "APPROVED",
    priorityFactors: { deadline: 100, waitingTime: 100, estimatedEffort: 100 },
  },
  {
    id: "task-4",
    clientId: "client-2",
    title: "Await homepage approval",
    status: "WAITING_APPROVAL",
    priorityFactors: { deadline: 90, waitingTime: 90, estimatedEffort: 90 },
  },
  {
    id: "task-5",
    clientId: "client-1",
    title: "Draft launch checklist",
    status: "NOT_STARTED",
    priorityFactors: { deadline: 40, waitingTime: 25, estimatedEffort: 40 },
  },
  {
    id: "task-6",
    clientId: "client-2",
    title: "Resolve content notes",
    status: "NOT_STARTED",
    priorityFactors: { deadline: 72, waitingTime: 72, estimatedEffort: 72 },
  },
  {
    id: "task-0",
    clientId: "client-1",
    title: "Confirm delivery details",
    status: "NOT_STARTED",
    priorityFactors: { deadline: 72, waitingTime: 72, estimatedEffort: 72 },
  },
];
