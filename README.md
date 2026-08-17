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

## Read-only Notion setup

Milestone 3 uses an internal Notion integration and Notion API version
`2026-03-11`. The adapter can read and normalize data but is not connected to
the API dashboard yet.

1. Open Notion's integration settings and create an internal integration for
   this application. Under capabilities, grant **Read content** only. Do not
   grant insert, update, comment, or user-information capabilities.

2. In Notion, open Mariana's Clients database and use its sharing or
   connections menu to share that database with the integration. Repeat for
   the Tasks database. Share exactly those two databases, not the workspace or
   unrelated pages.

3. Obtain each database container ID from its Notion URL. Use the database ID,
   not a view ID. The adapter retrieves each container and discovers its child
   data-source ID. A database with zero or multiple data sources is rejected.

4. Put the token and the two container IDs in the ignored local `.env` file:

   ```text
   NOTION_TOKEN=<internal-integration-token>
   NOTION_CLIENTS_DATABASE_ID=<clients-database-container-id>
   NOTION_TASKS_DATABASE_ID=<tasks-database-container-id>
   ```

   Never paste a token into chat, source control, screenshots, logs, command
   output, or shell history. Edit `.env` directly rather than exporting the
   token in an interactive shell command.

5. The default property mapping is:

   | Database | Property    | Notion type                 | Required |
   | -------- | ----------- | --------------------------- | -------- |
   | Clients  | `Name`      | title                       | yes      |
   | Tasks    | `Tarea`     | title                       | yes      |
   | Tasks    | `Clientes`  | relation (exactly one page) | yes      |
   | Tasks    | `Tipo`      | select                      | no       |
   | Tasks    | `Date`      | date                        | no       |
   | Tasks    | `Estado`    | status                      | yes      |
   | Tasks    | `Prioridad` | select                      | no       |

   If Mariana's property names differ, set the corresponding optional values
   documented in `.env.example`. All task property mappings must be distinct.
   `Clientes` remains the canonical client relationship. The non-canonical
   `Cliente` select is ignored and is never used as a fallback. Tasks with an
   empty `Clientes` relation are excluded from the read snapshot, and the
   snapshot reports how many were skipped so incomplete historical data remains
   visible. This behavior is based only on the relation and does not filter by
   task dates. `Tipo` and `Prioridad` are preserved as trimmed Notion option
   names without interpretation, `Date.start` becomes the task due date, and
   `Checkbox` is ignored. The adapter validates both data-source schemas before
   reading pages and rejects more than 5,000 rows per data source, which is an
   intentional safety limit for this small-workspace application.

6. Run the manual read-only verification:

   ```bash
   pnpm notion:verify
   ```

   This command performs reads only and prints aggregate client, included task,
   skipped-unlinked-task, canonical status, task-type, and priority counts. It
   never prints client names, task titles, IDs, tokens, URLs, headers, or raw
   Notion responses. It is intentionally excluded from `pnpm check` and CI.
   Without all three required Notion variables, it reports a safe skip.

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
