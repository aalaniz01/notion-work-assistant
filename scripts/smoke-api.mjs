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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json();
  return { response, body };
}

const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: "", PORT: "0" },
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

  const session = await fetchJson(`${address}/api/auth/session`);
  assert.equal(session.response.status, 200);
  assert.deepEqual(session.body, { authenticated: false });

  const login = await fetchJson(`${address}/api/auth/login`, {
    redirect: "manual",
  });
  assert.equal(login.response.status, 503);
  assert.deepEqual(login.body, { error: { code: "OIDC_UNAVAILABLE" } });

  const protectedDashboard = await fetchJson(
    `${address}/api/workspaces/11111111-1111-4111-8111-111111111111/dashboard`,
  );
  assert.equal(protectedDashboard.response.status, 401);
  assert.deepEqual(protectedDashboard.body, {
    error: { code: "UNAUTHENTICATED" },
  });

  const unavailableAuthentication = await fetchJson(
    `${address}/api/workspaces/11111111-1111-4111-8111-111111111111/dashboard`,
    { headers: { Cookie: `nwa_session=${"a".repeat(43)}` } },
  );
  assert.equal(unavailableAuthentication.response.status, 503);
  assert.deepEqual(unavailableAuthentication.body, {
    error: { code: "AUTH_UNAVAILABLE" },
  });

  const legacyDashboard = await fetchJson(`${address}/api/dashboard`);
  assert.equal(legacyDashboard.response.status, 404);
} finally {
  await stopServer(child);
}

process.stdout.write("Production API smoke test passed\n");
