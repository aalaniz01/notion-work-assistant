import type { Database } from "./client.js";

const DEFAULT_TIMEOUT_MS = 2_000;

export function createDatabaseReadinessCheck(
  database: Database,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): () => Promise<boolean> {
  let pendingProbe: Promise<boolean> | undefined;

  function startProbe(): Promise<boolean> {
    let probe: Promise<boolean>;
    try {
      probe = database.client`select 1`.execute().then(
        () => true,
        () => false,
      );
    } catch {
      probe = Promise.resolve(false);
    }

    pendingProbe = probe.finally(() => {
      pendingProbe = undefined;
    });
    return pendingProbe;
  }

  return async () => {
    const probe = pendingProbe ?? startProbe();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });

    try {
      return await Promise.race([probe, deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}
