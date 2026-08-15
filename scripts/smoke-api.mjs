import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const FORCE_KILL_TIMEOUT_MS = 2_000;
const STARTUP_MARKER = /^API_LISTENING=(http:\/\/127\.0\.0\.1:\d+)$/m;

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`API did not stop within ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      child.off("exit", onExit);
    }

    function onExit(code, signal) {
      cleanup();
      resolve({ code, signal });
    }

    child.once("exit", onExit);
  });
}

function waitForStartup(child, getStderr) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `API did not emit its startup marker within ${STARTUP_TIMEOUT_MS}ms`,
        ),
      );
    }, STARTUP_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    }

    function onData(chunk) {
      stdout += chunk.toString();
      const match = stdout.match(STARTUP_MARKER);
      if (match?.[1]) {
        cleanup();
        resolve(match[1]);
      }
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onExit(code, signal) {
      cleanup();
      reject(
        new Error(
          `API exited before startup (code=${String(code)}, signal=${String(signal)})\n${getStderr()}`,
        ),
      );
    }

    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");

  try {
    const result = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
    assert.equal(result.code, 0, `API exited with code ${String(result.code)}`);
    assert.equal(
      result.signal,
      null,
      `API exited from signal ${String(result.signal)}`,
    );
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, FORCE_KILL_TIMEOUT_MS).catch(() => undefined);
    }
    throw error;
  }
}

function assertDashboard(value) {
  assert(value && typeof value === "object");
  assert(Array.isArray(value.clients));
  assert(Array.isArray(value.recommendations));

  for (const client of value.clients) {
    assert.equal(typeof client.id, "string");
    assert.equal(typeof client.name, "string");
  }

  for (const recommendation of value.recommendations) {
    assert(recommendation && typeof recommendation === "object");
    assert.equal(typeof recommendation.task?.id, "string");
    assert.equal(typeof recommendation.task?.clientId, "string");
    assert.equal(typeof recommendation.task?.title, "string");
    assert.equal(typeof recommendation.task?.status, "string");
    assert(recommendation.task?.priorityFactors);
    assert.equal(typeof recommendation.priority?.recommendationScore, "number");
    assert(
      ["LOW", "MEDIUM", "HIGH"].includes(
        recommendation.priority?.priorityLevel,
      ),
    );
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json();
  return { response, body };
}

const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const address = await waitForStartup(child, () => stderr);

  const health = await fetchJson(`${address}/health`);
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { status: "ok" });

  const dashboard = await fetchJson(`${address}/api/dashboard`);
  assert.equal(dashboard.response.status, 200);
  assertDashboard(dashboard.body);
} finally {
  await stopServer(child);
}

process.stdout.write("Production API smoke test passed\n");
