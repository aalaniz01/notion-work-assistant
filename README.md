# Notion Work Assistant

Notion remains the source of truth for clients and tasks. PostgreSQL stores
only application-owned data such as workspace identity and priority settings.

## Requirements

- Node.js 24
- pnpm 10.15.1
- Docker with Docker Compose

## Local setup

The credentials below are local development values only. They are not
production secrets and must not be reused outside local development.

1. Start PostgreSQL. On a fresh volume, the Compose initialization creates
   both `nwa` and `nwa_test`:

   ```bash
   docker compose up -d postgres
   ```

2. If the named volume already existed before `nwa_test` was introduced,
   create the test database explicitly:

   ```bash
   docker compose exec postgres psql -U nwa -d postgres -c "CREATE DATABASE nwa_test"
   ```

3. Create a local environment file from the placeholder template and use
   these local-only URLs:

   ```bash
   cp .env.example .env
   ```

   ```text
   DATABASE_URL=postgresql://nwa:nwa@127.0.0.1:5432/nwa
   TEST_DATABASE_URL=postgresql://nwa:nwa@127.0.0.1:5432/nwa_test
   ```

4. Install and migrate:

   ```bash
   pnpm install --frozen-lockfile
   pnpm db:migrate
   ```

5. Start the application:

   ```bash
   pnpm dev
   ```

`GET /health` reports process liveness and never checks PostgreSQL.
`GET /health/ready` reports database readiness and returns HTTP 503 when
PostgreSQL is missing or unreachable.

## Database workflow

After changing `packages/db/src/schema.ts`:

```bash
pnpm db:generate
```

Review and commit the generated SQL and Drizzle metadata. Apply migrations
explicitly with `pnpm db:migrate`. The API never runs migrations during normal
startup. Do not use drop or reset commands.

The `updated_at` columns currently receive insert defaults only. Automatic
timestamp maintenance is deferred until the first real application write path.

## Checks

The fast gate does not require PostgreSQL:

```bash
pnpm check
```

Database integration tests require `TEST_DATABASE_URL` to name a database
ending exactly in `_test`; otherwise they abort before migration or cleanup:

```bash
pnpm test:db
```

Run both gates with:

```bash
pnpm check:all
```
