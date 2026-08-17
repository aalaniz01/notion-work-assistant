import { expectTypeOf } from "vitest";
import { describe, expect, it } from "vitest";

import {
  createNotionReadClient,
  NOTION_API_VERSION,
  NOTION_MAX_RETRIES,
  NOTION_REQUEST_TIMEOUT_MS,
  type NotionReadClient,
} from "./notion-client.js";

describe("Notion SDK client factory", () => {
  it("supplies explicit version, timeout, retries, and a no-op logger", () => {
    const fakeClient = {} as NotionReadClient;
    let received:
      | {
          notionVersion: string;
          timeoutMs: number;
          logLevel: string;
          logger: (...args: unknown[]) => void;
          retry: {
            maxRetries: number;
            initialRetryDelayMs: number;
            maxRetryDelayMs: number;
          };
        }
      | undefined;

    const client = createNotionReadClient("private-token", (options) => {
      received = options;
      return fakeClient;
    });

    expect(client).not.toBe(fakeClient);
    expect(Object.keys(client).sort()).toEqual(["dataSources", "databases"]);
    expect(Object.keys(client.databases)).toEqual(["retrieve"]);
    expect(Object.keys(client.dataSources).sort()).toEqual([
      "query",
      "retrieve",
    ]);
    expect(received).toMatchObject({
      notionVersion: "2026-03-11",
      timeoutMs: 10_000,
      logLevel: "error",
      retry: {
        maxRetries: 2,
        initialRetryDelayMs: 1_000,
        maxRetryDelayMs: 60_000,
      },
    });
    expect(() => received?.logger("ignored")).not.toThrow();
    expect(NOTION_API_VERSION).toBe("2026-03-11");
    expect(NOTION_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(NOTION_MAX_RETRIES).toBe(2);
  });

  it("exposes no write-capable SDK services to the reader", () => {
    expectTypeOf<NotionReadClient>().toHaveProperty("databases");
    expectTypeOf<NotionReadClient>().toHaveProperty("dataSources");
    expectTypeOf<NotionReadClient>().not.toHaveProperty("pages");
    expectTypeOf<NotionReadClient>().not.toHaveProperty("blocks");
    expectTypeOf<NotionReadClient>().not.toHaveProperty("comments");
  });
});
