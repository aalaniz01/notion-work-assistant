import type { Dashboard, PriorityLevel } from "@notion-work-assistant/domain";
import { useEffect, useState } from "react";

import { getSession, logout, LogoutTransportError } from "./api/auth";
import { getDashboard } from "./api/dashboard";
import { ApiError } from "./api/request";

type AppState =
  | { status: "checking-session" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "workspace-selection-required" }
  | { status: "loading-dashboard" }
  | { status: "error" }
  | { status: "logout-unknown" }
  | { status: "ready"; dashboard: Dashboard };

type AuthenticationError =
  | "access_denied"
  | "authentication_failed"
  | "not_authorized"
  | "service_unavailable";

const authenticationErrorMessages: Record<AuthenticationError, string> = {
  access_denied: "Sign-in was cancelled.",
  authentication_failed: "Sign-in could not be completed.",
  not_authorized: "This identity is not authorized.",
  service_unavailable: "Sign-in is temporarily unavailable.",
};

function isAuthenticationError(
  value: string | null,
): value is AuthenticationError {
  return value !== null && Object.hasOwn(authenticationErrorMessages, value);
}

const priorityLabels: Record<PriorityLevel, string> = {
  HIGH: "High priority",
  MEDIUM: "Medium priority",
  LOW: "Low priority",
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function App() {
  const [state, setState] = useState<AppState>({
    status: "checking-session",
  });
  const [authenticationError, setAuthenticationError] =
    useState<AuthenticationError>();
  const [logoutWarning, setLogoutWarning] = useState<
    "revocation-unconfirmed" | undefined
  >();

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const value = parameters.get("auth_error");
    if (isAuthenticationError(value)) setAuthenticationError(value);
    if (value !== null) {
      parameters.delete("auth_error");
      const query = parameters.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const session = await getSession(controller.signal);
        if (!session.authenticated) {
          setState({ status: "signed-out" });
          return;
        }
        if (session.workspaces.length === 0) {
          setState({ status: "forbidden" });
          return;
        }
        if (session.workspaces.length > 1) {
          setState({ status: "workspace-selection-required" });
          return;
        }

        setState({ status: "loading-dashboard" });
        const dashboard = await getDashboard(
          session.workspaces[0]!.id,
          controller.signal,
        );
        setState({ status: "ready", dashboard });
      } catch (error) {
        if (isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        setState({ status: "error" });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  async function handleLogout(): Promise<void> {
    try {
      const result = await logout();
      setAuthenticationError(undefined);
      setLogoutWarning(
        result === "revocation-unconfirmed"
          ? "revocation-unconfirmed"
          : undefined,
      );
      setState({ status: "signed-out" });
    } catch (error) {
      if (error instanceof LogoutTransportError) {
        setState({ status: "logout-unknown" });
        return;
      }
      setState({ status: "error" });
    }
  }

  return (
    <main>
      <header className="masthead">
        <p className="eyebrow">Notion Work Assistant</p>
        <h1>Work that needs your attention.</h1>
        <p className="intro">
          A focused view of active client work, ordered by its recommendation
          score.
        </p>
      </header>

      {authenticationError && (
        <p className="notice notice-error" role="alert">
          {authenticationErrorMessages[authenticationError]}
        </p>
      )}
      {logoutWarning === "revocation-unconfirmed" && (
        <p className="notice notice-error" role="alert">
          Signed out of this browser, but server-side revocation could not be
          confirmed.
        </p>
      )}

      {(state.status === "checking-session" ||
        state.status === "loading-dashboard") && (
        <p className="notice" role="status">
          {state.status === "checking-session"
            ? "Checking your session..."
            : "Preparing your dashboard..."}
        </p>
      )}
      {state.status === "signed-out" && (
        <div className="notice">
          <p>Sign in is required to view this workspace.</p>
          <a className="auth-action" href="/api/auth/login">
            Sign in
          </a>
        </div>
      )}
      {state.status === "forbidden" && (
        <p className="notice notice-error">
          You do not have access to this workspace.
        </p>
      )}
      {state.status === "workspace-selection-required" && (
        <p className="notice">
          Workspace selection is required before loading the dashboard.
        </p>
      )}
      {state.status === "error" && (
        <p className="notice notice-error">
          The dashboard is unavailable. Try again shortly.
        </p>
      )}
      {state.status === "logout-unknown" && (
        <p className="notice notice-error" role="alert">
          Sign out could not be confirmed. Check your connection and try again.
        </p>
      )}
      {(state.status === "ready" ||
        state.status === "forbidden" ||
        state.status === "workspace-selection-required") && (
        <div className="auth-actions">
          <button
            className="auth-action"
            type="button"
            onClick={() => void handleLogout()}
          >
            Sign out
          </button>
        </div>
      )}
      {state.status === "ready" &&
        state.dashboard.recommendations.length === 0 && (
          <p className="notice">No work needs a recommendation right now.</p>
        )}
      {state.status === "ready" &&
        state.dashboard.recommendations.length > 0 && (
          <section
            className="recommendations"
            aria-label="Task recommendations"
          >
            {state.dashboard.recommendations.map(
              ({ task, priority }, index) => {
                const client = state.dashboard.clients.find(
                  ({ id }) => id === task.clientId,
                );

                return (
                  <article className="task" key={task.id}>
                    <span className="rank" aria-label={`Rank ${index + 1}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="task-copy">
                      <p className="client">
                        {client?.name ?? "Unknown client"}
                      </p>
                      <h2>{task.title}</h2>
                      <p className="status">
                        {task.status.replaceAll("_", " ")}
                      </p>
                    </div>
                    <div
                      className={`score score-${priority.priorityLevel.toLowerCase()}`}
                    >
                      <strong>{priority.recommendationScore}</strong>
                      <span>{priorityLabels[priority.priorityLevel]}</span>
                    </div>
                  </article>
                );
              },
            )}
          </section>
        )}
    </main>
  );
}
