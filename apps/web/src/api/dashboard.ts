import type { Dashboard } from "@notion-work-assistant/domain";

import { requestJson } from "./request";

export function getDashboard(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Dashboard> {
  return requestJson<Dashboard>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/dashboard`,
    signal,
  );
}
