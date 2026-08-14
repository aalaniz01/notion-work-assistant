import type { Dashboard } from "@notion-work-assistant/domain";

export async function getDashboard(signal?: AbortSignal): Promise<Dashboard> {
  const response = await fetch("/api/dashboard", { signal });
  if (!response.ok) {
    throw new Error("Dashboard request failed");
  }

  return response.json() as Promise<Dashboard>;
}
