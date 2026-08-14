import type { Dashboard, PriorityLevel } from "@notion-work-assistant/domain";
import { useEffect, useState } from "react";

import { getDashboard } from "./api/dashboard";

type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; dashboard: Dashboard };

const priorityLabels: Record<PriorityLevel, string> = {
  HIGH: "High priority",
  MEDIUM: "Medium priority",
  LOW: "Low priority",
};

export function App() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    void getDashboard(controller.signal)
      .then((dashboard) => setState({ status: "ready", dashboard }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setState({ status: "error" });
      });

    return () => controller.abort();
  }, []);

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

      {state.status === "loading" && (
        <p className="notice">Preparing your dashboard...</p>
      )}
      {state.status === "error" && (
        <p className="notice notice-error">
          The dashboard is unavailable. Try again shortly.
        </p>
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
