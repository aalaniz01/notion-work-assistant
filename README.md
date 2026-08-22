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

## Authentication

The application uses provider-independent application users, external identity
mappings, workspace memberships, and opaque server-side sessions. PostgreSQL
stores only a SHA-256 hash of each session token. Raw tokens are accepted only
from the `nwa_session` cookie and are never returned by an API route, logged, or
persisted.

OIDC login uses backend-owned Authorization Code Flow with PKCE. Each attempt
has independent state, nonce, and PKCE values in a short-lived encrypted
HttpOnly cookie. Provider tokens are validated in memory and discarded. The
callback accepts only an existing exact issuer/subject mapping; it never creates
users or workspace memberships. There is no local authentication bypass.

OIDC is optional only so health checks, anonymous behavior, and normal CI can
run without real provider credentials. If any OIDC setting is present, the full
configuration is required. Configure the five concepts documented in
`.env.example`; omit `OIDC_CLIENT_SECRET` entirely for a public client. The
callback is always derived as `${APPLICATION_ORIGIN}/api/auth/callback`.

For local development, register
`http://localhost:5173/api/auth/callback` with the selected provider and set
`APPLICATION_ORIGIN=http://localhost:5173`. Generate
`OIDC_TRANSIENT_SECRET` as exactly 32 random bytes encoded as unpadded
base64url. Production origins must use HTTPS; provider issuers must always use
HTTPS.

An operator must provision an identity before it can log in. The workspace must
already exist, and issuer and subject are exact provider identifiers rather
than an email address:

```bash
pnpm auth:provision --issuer <exact-issuer> --subject <exact-subject> --workspace-id <existing-workspace-uuid>
```

The command emits only a safe success or failure message. It performs no
provider request and does not print claims or tokens. Unknown or disabled
identities fail closed at callback time.

Because the established application cookie name is `nwa_session`, deploy the
application on an origin whose parent domain has no untrusted sibling
applications capable of setting parent-domain cookies. A future deployment
hardening migration should use `__Host-` cookie names with `Path=/`; it is
deferred because Milestone 4A established the current cookie name and callback
attempt path.

`GET /api/auth/session` always returns HTTP 200 for an ordinary anonymous or
invalid session:

```json
{ "authenticated": false }
```

An authenticated session receives its currently authorized workspaces. The
dashboard is available only from `GET /api/workspaces/:workspaceId/dashboard`.
The backend authenticates first, validates the workspace UUID second, and then
verifies an active membership before reading Notion. The legacy
`GET /api/dashboard` route no longer serves dashboard data.

`GET /health` and `GET /health/ready` remain public and never perform session or
membership checks.

## Read-only Notion setup

Milestone 3 uses an internal Notion integration and Notion API version
`2026-03-11`. Milestone 5 connects that adapter to the authenticated dashboard:
after authentication and membership verification, each dashboard request reads
the Clients and Tasks data sources, computes deadline, waiting-time, and effort
factors, and returns a recommendation-sorted dashboard. The dashboard fails
closed with `NOTION_UNAVAILABLE` when Notion is unconfigured or unreachable;
there is no fake-data fallback.

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

## Dashboard scoring

Each included task produces three 0-to-100 priority factors from the read-only
snapshot using the server's current date (UTC calendar days, so scores never
vary by server timezone):

- **Deadline**: `0` when the task has no due date, `100` when overdue or due
  today, otherwise `clamp(100 - daysRemaining * 10, 0, 100)`.
- **Waiting time**: `clamp(daysSinceCreated * 10, 0, 100)` using Notion's page
  creation time.
- **Estimated effort**: a constant `50`; Notion has no effort property.

`APPROVED` and `WAITING_APPROVAL` tasks are excluded. The recommendation score
is the weighted sum of the three factors plus a status bonus
(`CHANGES_REQUESTED` +10, `IN_PROGRESS` +5), rounded and capped at 100. The
default weights are 50/40/10 (deadline/waiting time/effort). A
`priority_settings` row for the workspace overrides those weights and must sum
to exactly 100; weights live in PostgreSQL, never duplicated from Notion. If
no row exists the defaults apply, but a settings read failure fails the request
rather than silently using defaults. Notion errors never leak into responses:
the API returns only a `NOTION_UNAVAILABLE` error code.

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
