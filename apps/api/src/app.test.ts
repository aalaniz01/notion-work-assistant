import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("API", () => {
  it("returns process health", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns eligible recommendations in deterministic priority order", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = response.json<{
      recommendations: Array<{
        task: { id: string; status: string };
        priority: { recommendationScore: number };
      }>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.recommendations.map(({ task }) => task.status)).not.toContain(
      "APPROVED",
    );
    expect(body.recommendations.map(({ task }) => task.status)).not.toContain(
      "WAITING_APPROVAL",
    );
    expect(body.recommendations.map(({ task }) => task.id)).toEqual([
      "task-0",
      "task-1",
      "task-6",
      "task-2",
      "task-5",
    ]);
    expect(
      body.recommendations.map(({ priority }) => priority.recommendationScore),
    ).toEqual([72, 72, 72, 62, 34]);
  });
});
