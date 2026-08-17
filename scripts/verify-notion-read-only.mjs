import {
  createNotionReader,
  NotionAdapterError,
} from "../packages/notion/dist/index.js";

const requiredVariables = [
  "NOTION_TOKEN",
  "NOTION_CLIENTS_DATABASE_ID",
  "NOTION_TASKS_DATABASE_ID",
];

if (requiredVariables.some((name) => !process.env[name]?.trim())) {
  process.stdout.write("NOTION_VERIFY_SKIPPED=missing_configuration\n");
  process.exit(0);
}

try {
  const snapshot = await createNotionReader(process.env).fetchSnapshot();
  const statuses = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    WAITING_APPROVAL: 0,
    CHANGES_REQUESTED: 0,
    APPROVED: 0,
  };
  const taskTypes = new Map();
  const priorities = new Map();

  for (const task of snapshot.tasks) {
    statuses[task.status] += 1;
    if (task.taskType) {
      taskTypes.set(task.taskType, (taskTypes.get(task.taskType) ?? 0) + 1);
    }
    if (task.priority) {
      priorities.set(task.priority, (priorities.get(task.priority) ?? 0) + 1);
    }
  }

  const sortedCounts = (counts) =>
    Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );

  process.stdout.write(
    `NOTION_VERIFY_SUMMARY=${JSON.stringify({
      clients: snapshot.clients.length,
      tasks: snapshot.tasks.length,
      skippedTasksWithoutClient: snapshot.skippedTasks.missingClientRelation,
      statuses,
      taskTypes: sortedCounts(taskTypes),
      priorities: sortedCounts(priorities),
    })}\n`,
  );
} catch (error) {
  const code =
    error instanceof NotionAdapterError ? error.code : "UNEXPECTED_ERROR";
  process.stderr.write(`NOTION_VERIFY_FAILED=${code}\n`);
  process.exitCode = 1;
}
