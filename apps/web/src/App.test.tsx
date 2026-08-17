// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const dashboard = {
  clients: [{ id: "client-1", name: "Client" }],
  recommendations: [
    {
      task: {
        id: "task-1",
        clientId: "client-1",
        title: "Task title",
        status: "NOT_STARTED",
        priorityFactors: { deadline: 1, waitingTime: 2, estimatedEffort: 3 },
      },
      priority: { recommendationScore: 42, priorityLevel: "MEDIUM" },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App authentication states", () => {
  it("renders signed-out state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ authenticated: false })),
    );

    render(<App />);

    expect(
      await screen.findByText("Sign in is required to view this workspace."),
    ).toBeTruthy();
  });

  it("uses the only authorized workspace and renders the fake dashboard", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          workspaces: [{ id: WORKSPACE_ID, name: "Workspace" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(dashboard));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("Task title")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/workspaces/${WORKSPACE_ID}/dashboard`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("renders forbidden when the user has no workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ authenticated: true, workspaces: [] }),
        ),
    );

    render(<App />);

    expect(
      await screen.findByText("You do not have access to this workspace."),
    ).toBeTruthy();
  });

  it("requires selection without loading a dashboard for multiple workspaces", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        authenticated: true,
        workspaces: [
          { id: WORKSPACE_ID, name: "First" },
          { id: "22222222-2222-4222-8222-222222222222", name: "Second" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByText(
        "Workspace selection is required before loading the dashboard.",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "Sign in is required to view this workspace."],
    [403, "You do not have access to this workspace."],
  ])("handles dashboard status %i", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            authenticated: true,
            workspaces: [{ id: WORKSPACE_ID, name: "Workspace" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({}, status)),
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  });

  it("renders a safe generic error for server failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    render(<App />);

    expect(
      await screen.findByText(
        "The dashboard is unavailable. Try again shortly.",
      ),
    ).toBeTruthy();
  });
});
