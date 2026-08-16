import { describe, expect, it } from "vitest";

import { requireTestDatabaseUrl } from "./test-database-safety.js";

describe("test database safety", () => {
  it("accepts a database name ending in _test", () => {
    const url = "postgresql://user:password@localhost:5432/nwa_test";

    expect(requireTestDatabaseUrl(url)).toBe(url);
  });

  it.each([
    undefined,
    "not-a-url",
    "https://localhost/nwa_test",
    "postgresql://localhost/nwa",
    "postgresql://localhost/nwa_test_backup",
    "postgresql://localhost/team/nwa_test",
  ])("rejects unsafe test database URL %s", (url) => {
    expect(() => requireTestDatabaseUrl(url)).toThrow();
  });
});
