export function requireTestDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required for database tests");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use postgres or postgresql");
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[^/]+_test$/.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL database name must end in _test");
  }

  return value;
}
