# StockWise Agent Guide

This file is the execution contract for human and AI developers working in the `stockwise` repository. Read it before every task.

| Field | Value |
| --- | --- |
| Documentation baseline | Architecture Freeze v1 |
| Last updated | 2026-08-24 |

## 1. Project overview

StockWise is a responsive, cloud-based retail platform for SMEs. It covers organization-level product and supplier management; branch-level inventory, purchasing/receiving, POS, and sales; deterministic analytics and forecasting; and scheduled aggregate summaries through OpenRouter.

The repository contains the **repository foundation, minimal web/API application shells, identity/tenancy database schema, pure authorization-policy foundation, and completed backend credential lifecycle through P2-M2-T03**. The pnpm workspace root, quality/test/CI/environment baselines, web/API shells, local PostgreSQL/Prisma foundation, identity/tenancy models/migrations, centralized typed RBAC policy, Argon2 registration/login, opaque hash-only sessions/authenticated context, current/all-session logout, verification issuance/resend/completion, provider-abstracted Resend/non-delivery email, and password recovery/session revocation exist. No onboarding, auth UI, invitation acceptance, authorization endpoint wiring, later-domain implementation/table, or production infrastructure implementation exists. Do not treat later planned directories, commands, schemas, endpoints, or features as existing code.

## 2. Read before changing anything

1. Read this file.
2. Inspect the actual repository, current branch/status if Git exists, and existing implementation.
3. Read the authoritative document for the task:
   - Product scope/open questions: `BUILD_SPEC.md`
   - Architecture: `docs/ARCHITECTURE.md`
   - Data: `docs/DATABASE.md`
   - Analytics/formulas: `docs/ANALYTICS.md`
   - Behavior: `USE_CASE_SPECS.md`
   - HTTP contracts: `docs/API.md`
   - Delivery order/status: `PROJECT_PLAN.md`
   - Decision rationale: `docs/DECISIONS.md`
4. Search for existing code and tests before creating new abstractions.
5. Identify any blocking Open Question by its `OQ-*` ID. Do not guess its answer.

## 2.1 Critical Domain Decision Gate

Repository/tooling work, application shells, and other unrelated foundation work may proceed when their own blockers are resolved. Significant business-domain implementation must not proceed until the decisions affecting that domain are accepted.

At minimum, enforce these gates:

- Identity/onboarding/authorization decisions are accepted in `ADR-013`–`ADR-017`; implementation must follow their session, email, onboarding, invitation, registration-security, and RBAC boundaries.
- Inventory and quantity mutations: `OQ-007`, `OQ-023`
- POS/sales monetary behavior: `OQ-007`, `OQ-008`, `OQ-010`, `OQ-023`, plus the accepted RBAC baseline in `ADR-016`
- Refund/void behavior: `OQ-009` in addition to the sales decisions
- Purchasing/receiving costing behavior: `OQ-007`, `OQ-010`, `OQ-023`
- Analytics and forecasting: `OQ-011`, `OQ-012`; plus any metric-specific dependency documented in `docs/ANALYTICS.md`

The accepted MVP roles are `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`. Authorization is fixed, deny-by-default RBAC from `ADR-016` and `BUILD_SPEC.md` section 8: a user has one organization role per organization; `OWNER`/`ADMIN` have organization-wide branch access; the remaining roles need explicit branch assignments. The Express API, not the frontend, is the security boundary. At least one OWNER must remain; refund/void authority remains open in `OQ-009`.

Cloud/operations questions such as `OQ-015`, `OQ-017`–`OQ-020` remain phase-specific and do not block Repository Foundation or unrelated domain work.

## 3. Accepted technology baseline

| Concern | Choice |
| --- | --- |
| Repository | One `stockwise` pnpm workspace; `apps/web`, `apps/api`, and justified `packages/*` |
| Runtime/package manager | Node.js 24 LTS + pnpm 11.19.0 |
| Frontend | Next.js + TypeScript |
| Backend | Express.js + TypeScript |
| API | REST under `/api/v1` |
| Database | PostgreSQL |
| ORM/migrations | Prisma |
| Validation | Zod |
| UI | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Server state | TanStack Query |
| Password hashing | Argon2 |
| AI | OpenRouter, scheduled aggregate summaries only |
| Cloud | AWS: RDS PostgreSQL, S3, VPC, CloudWatch, EventBridge; SQS only if justified |
| Packaging/CI | Docker + GitHub Actions |

Do not introduce Python, FastAPI, microservices, Kubernetes, another database, GraphQL, another ORM, or a second frontend/backend framework without an accepted architecture decision.

## 4. Project structure

### Current structure

The root foundation and minimal web shell exist:

```text
.github/workflows/ci.yml
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
.env.example
.gitignore
.gitattributes
compose.yaml
tsconfig.base.json
tsconfig.json
eslint.config.mjs
prettier.config.mts
.prettierignore
vitest.config.mts
test/smoke.test.ts
apps/web/package.json
apps/web/components.json
apps/web/next.config.ts
apps/web/postcss.config.mjs
apps/web/tsconfig.json
apps/web/src/environment.ts
apps/web/src/app/layout.tsx
apps/web/src/app/page.tsx
apps/web/src/components/app-shell.tsx
apps/web/src/providers/query-provider.tsx
apps/api/package.json
apps/api/tsconfig.json
apps/api/tsconfig.build.json
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20260822104545_identity_tenancy_schema/migration.sql
apps/api/prisma/migrations/20260824120921_make_user_display_name_nullable/migration.sql
apps/api/src/environment.ts
apps/api/src/logger.ts
apps/api/src/app.ts
apps/api/src/server.ts
apps/api/src/main.ts
apps/api/src/prisma/identity-tenancy-schema.test.ts
apps/api/src/modules/identity/authorization-policy.ts
apps/api/src/modules/identity/authorization-policy.test.ts
apps/api/src/modules/identity/password-hasher.ts
apps/api/src/modules/identity/password-hasher.test.ts
apps/api/src/modules/identity/registration-limiter.ts
apps/api/src/modules/identity/registration-limiter.test.ts
apps/api/src/modules/identity/registration-repository.ts
apps/api/src/modules/identity/registration-repository.test.ts
apps/api/src/modules/identity/registration-service.ts
apps/api/src/modules/identity/registration-service.test.ts
apps/api/src/modules/identity/registration-router.ts
apps/api/src/modules/identity/registration-router.test.ts
apps/api/src/modules/identity/registration.integration.test.ts
apps/api/src/modules/identity/credential-schemas.ts
apps/api/src/modules/identity/login-limiter.ts
apps/api/src/modules/identity/login-service.ts
apps/api/src/modules/identity/login-router.ts
apps/api/src/modules/identity/session-token.ts
apps/api/src/modules/identity/session-cookie.ts
apps/api/src/modules/identity/session-configuration.ts
apps/api/src/modules/identity/authentication-repository.ts
apps/api/src/modules/identity/authentication-context.ts
apps/api/src/modules/identity/authentication.integration.test.ts
apps/api/src/modules/identity/credential-lifecycle-repository.ts
apps/api/src/modules/identity/credential-lifecycle-service.ts
apps/api/src/modules/identity/credential-lifecycle-router.ts
apps/api/src/modules/identity/email-request-limiter.ts
apps/api/src/modules/identity/one-time-token.ts
apps/api/src/modules/identity/email-provider.ts
apps/api/src/modules/identity/email-provider-configuration.ts
apps/api/src/modules/identity/credential-lifecycle.integration.test.ts
```

The web and API packages have separate strict Zod environment schemas. P1-M2-T04 defines the local path: the API binds to `127.0.0.1:3001`, and Next.js serves the browser at `http://localhost:3000` with a same-origin `/api/health` rewrite to the Express `/health` probe. P1-M3 established local PostgreSQL, API-owned Prisma, and the isolated database test harness. P2-M1 established identity/tenancy persistence and pure authorization policy. P2-M2-T01/T02 add bounded registration/login, centralized Argon2, accepted limiters, opaque hash-only sessions/cookies, rotation/expiry/touch, and trusted actor/session context only. P2-M2-T03 adds safely idempotent current logout, authenticated all-session logout, hash-only 24-hour verification and 30-minute reset tokens, row-serialized replacement, atomic verification/reset/session-revocation transactions, independent three-per-15-minute resend/reset-request limiters, production Resend behind an identity-provider interface, and development/test non-delivery adapters. It adds no Prisma migration, authorization scope, onboarding, UI, or later-domain feature.

### Approved physical boundaries

`ADR-011` defines this layout. Application and infrastructure directories are created only by their assigned later tasks:

```text
apps/
  web/                 # Next.js application
  api/                 # Express modular monolith
    src/modules/       # API-owned domain modules
    prisma/            # API-owned schema and migrations
packages/              # Deliberately shared internal packages only when justified
docs/                  # Technical Source of Truth documents
tests/e2e/             # Cross-application end-to-end tests
infra/                 # Deployment/infrastructure configuration
```

Only `apps/*` and `packages/*` are pnpm package workspaces. Likely domain modules are identity, organizations, branches, catalog, inventory, suppliers, purchasing, sales/POS, analytics, and AI insights. Do not create a catch-all `utils`, `common`, or `shared` dumping ground.

## 5. Architecture rules

1. Use a **modular monolith**. Keep one deployable backend until an accepted ADR says otherwise.
2. `Organization` is the tenant boundary; `Branch` is the operational boundary.
3. Products, categories, and suppliers are organization-scoped.
4. Inventory, sales, POS, purchase orders, and receiving are branch-scoped.
5. A user may access multiple branches. Do not model a user with one `branchId` as the complete membership model.
6. Derive trusted organization/branch scope from authenticated memberships and authorization policy. A request body, query parameter, path parameter, or header is not proof of access.
7. Keep HTTP controllers thin. Put validation at boundaries, business rules in use-case/domain services, and persistence behind module-owned data access.
8. Avoid circular dependencies. Cross-module writes must go through an explicit use case or stable interface.
9. Core retail workflows must not depend on OpenRouter availability.
10. Analytics and forecasts are deterministic TypeScript/SQL logic. The LLM summarizes an aggregate snapshot only.
11. Optional AWS services such as SQS require a demonstrated workload need and an accepted update to architecture/decisions.

## 6. Coding conventions

These rules are accepted; exact formatter/linter configuration is part of Repository Foundation.

- Use TypeScript in strict mode. Do not silence errors with broad `any`, unsafe casts, or blanket ignores.
- Prefer small, cohesive modules and functions with domain names over framework names.
- Keep side effects at boundaries and make calculation code pure where practical.
- Use dependency injection through explicit constructors/factories or parameters; do not hide mutable global state.
- Validate external input once at the boundary with Zod and pass typed values inward.
- Return intentional domain/application errors and map them to the canonical API error envelope.
- Use async/await consistently; handle rejected promises and provider timeouts explicitly.
- Never use JavaScript `number` arithmetic as the source of truth for money. Use Prisma `Decimal`/a deliberate decimal representation.
- Add comments for invariants and surprising trade-offs, not for obvious syntax.
- Avoid speculative abstractions, premature generic repositories, and unused extension points.

## 7. Naming conventions

- TypeScript files and directories: use the convention selected during foundation consistently; do not mix styles within a module.
- React components and exported types/classes: `PascalCase`.
- Functions, variables, and object properties: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` only for true constants/environment keys.
- Database tables/columns and Prisma mapping: select one consistent convention during schema foundation and document it in `docs/DATABASE.md`.
- REST paths: plural kebab-case resources under `/api/v1`.
- Zod schemas: descriptive names ending in `Schema`.
- Tests: name by behavior, for example `rejects checkout from another branch`.
- IDs in documentation: `FR-*`, `UC-*`, `OQ-*`, `ADR-*`, and plan task IDs are stable; do not renumber casually.

## 8. Database rules

1. PostgreSQL and Prisma are the only accepted primary persistence stack.
2. Every business record must carry or derive its organization ownership. Branch-owned records must be verified to belong to that same organization.
3. Use both an `InventoryBalance` projection and append-oriented `InventoryTransaction` ledger.
4. Never update a stock balance without creating the corresponding ledger entry in the same transaction.
5. Checkout, receiving, adjustments, and reversal flows must use database transactions and be safe under concurrency.
6. Sale items and purchase/receipt lines must retain historical snapshots needed to explain past totals and costs.
7. Store money/cost in PostgreSQL `NUMERIC`/`DECIMAL` and Prisma `Decimal`.
8. Enforce invariants with database constraints and indexes as well as application validation.
9. Use UTC timestamps. Report/display timezone remains governed by `OQ-016`.
10. Use explicit idempotency for retryable creates such as checkout and scheduled snapshots.
11. Do not hard-delete ledger, completed sale, payment, or completed receipt history. Use an explicit lifecycle/reversal rule.
12. Physical ID types, exact columns, status enums, delete/retention behavior, costing, and receipt numbering must follow `docs/DATABASE.md` and unresolved Open Questions.

## 9. Migration policy

- Prisma migrations must be generated, reviewed, and committed with the schema change only when the user has authorized the implementation task.
- Never edit an already-applied shared/production migration to change history. Create a forward migration.
- Never run destructive/reset/drop/truncate commands against a shared, staging, or production database.
- Never run `prisma migrate reset` or equivalent without the user explicitly naming and authorizing the disposable target.
- Before applying a migration, inspect the generated SQL for table rewrites, dropped/renamed objects, nullable-to-required changes, uniqueness failures, locks, and data backfill needs.
- Pair schema changes with application changes, tests, rollback/forward-recovery notes, and documentation updates.
- Do not create a migration for a model affected by a blocking Open Question.
- Treat production data migration and deployment as separate, explicitly authorized work.

## 10. API rules

- Use REST under `/api/v1` and the contracts in `docs/API.md`.
- Authenticate and authorize on the server for every protected endpoint.
- Validate path, query, header, and body input with Zod.
- Recalculate trusted prices, totals, organization scope, branch scope, and actor on the server.
- Use a consistent success representation and the canonical error envelope.
- Use appropriate HTTP status codes without leaking stack traces, SQL details, secrets, existence of inaccessible tenant resources, or provider internals.
- Paginate list endpoints and define stable sorting.
- Require idempotency keys where `docs/API.md` specifies retry-safe creation.
- Do not publish an endpoint whose behavior depends on an unresolved product rule. Mark the contract blocked instead.
- Update `docs/API.md`, use cases, and tests in the same change as a contract change.

## 11. Security rules

- Registration passwords contain 15–128 Unicode code points and are preserved exactly: do not trim, normalize, truncate, or add composition rules. Whitespace and Unicode are allowed; breached-password screening is deferred.
- P2-M2-T01 uses `argon2@0.45.1` Argon2id with `memoryCost=65536` KiB, `timeCost=3`, `parallelism=4`, a library-generated salt, and PHC-format storage. Never log, return, or persist plaintext passwords.
- New and canonical-email duplicate registration attempts return the same generic `202 Accepted` public response. Registration permits five attempts per 15 minutes per canonical email in deterministic process-local memory, logs neither email nor password, and returns `429` with `Retry-After` when exhausted. Distributed/IP-aware controls and proxy trust remain `OQ-020`.
- P2-M2-T01 creates an unverified user with nullable `displayName` but no verification token or email. P2-M2-T03 owns token creation/resend, provider integration/delivery, and verification.
- Browser authentication uses only the `ADR-013` opaque, hash-only PostgreSQL session in an HttpOnly host-only `SameSite=Lax` cookie (`Secure` in production). Do not add JWT browser authentication, web-storage tokens, or refresh-token flows.
- Login uses `stockwise_session` with `Path=/`, no `Domain`, and `Secure` only when required `STOCKWISE_RUNTIME_ENV=production`; local HTTP development uses `development`. Session idle, absolute, and touch-minute values are API-owned configuration with accepted baselines `1440`, `10080`, and `15`.
- Login processes five credential failures per canonical email per fixed 15-minute process-local window. Only credential failures count and success does not reset the active window. Missing accounts use the fixed centralized dummy Argon2 PHC verifier; never generate it per request or log it.
- Successful login always creates a fresh 32-byte CSPRNG token and stores only its SHA-256 hash. A currently valid same-user incoming session is revoked as `login_rotation` in the fresh-session transaction. Authentication context contains active verified actor/session identity only; never derive memberships, roles, organizations, branches, or permissions from client input.
- Verification resend and password-reset request independently permit three syntactically valid requests per canonical email per fixed 15-minute process-local window. The SHA-256-derived key contains no plaintext email; every valid request consumes before lookup/provider work regardless of existence, eligibility, or delivery result. Attempt four returns `429` plus deterministic `Retry-After`; malformed email creates no entry. Reset completion has no MVP limiter and rejects invalid token state before Argon2. `OQ-020` remains open for distributed/IP/global/provider/proxy/multi-instance/production hardening.
- Verification/reset use fresh 32-byte opaque tokens with SHA-256-only persistence, 24-hour/30-minute expiry, row-serialized replacement, conditional single-use consumption, and provider-failure compensation. Production alone uses the Resend adapter with server-only `RESEND_API_KEY`/`STOCKWISE_EMAIL_FROM`; development/test never deliver by default. Never log provider payloads, complete sensitive URLs, raw/hash tokens, or provider errors.
- Apply rate limiting/abuse controls to authentication and other sensitive endpoints.
- Prevent horizontal and vertical privilege escalation with organization, branch, and role checks.
- Use generic not-found/forbidden behavior that does not reveal another tenant's data.
- Never commit secrets or include them in examples. Provide redacted `.env.example` names only.
- Keep secrets and personal data out of logs, analytics snapshots, AI prompts, errors, fixtures, and screenshots.
- OpenRouter receives only minimized aggregates and never database credentials or direct database access.
- Use least-privilege credentials and private RDS networking in production.
- Review new dependencies for maintenance, license, size, and known security issues.

## 12. Dependency policy

- Prefer platform/framework capabilities and existing dependencies.
- Add a runtime dependency only when it provides clear value that would be risky or wasteful to reproduce.
- Before adding one, record the purpose, alternatives considered, maintenance/security/license status, and bundle/runtime impact in the implementation plan.
- Pin and lock dependencies through the selected package manager. Do not hand-edit a lockfile.
- Avoid overlapping libraries for the same concern.
- Major-version upgrades and framework replacements require their own reviewed task; architecture changes require an ADR.
- SQS, Redis, a job framework, a second service, or a second language is not a harmless dependency—it changes architecture and needs explicit approval.

## 13. Testing requirements

Every implementation task must add or update tests proportionate to risk.

- **Unit tests:** calculations, state transitions, validation, permission decisions, and error mapping.
- **Database integration tests:** constraints, tenant/branch isolation, Prisma queries, atomic checkout/receiving, ledger-balance consistency, idempotency, and concurrency.
- **API integration tests:** authentication/authorization, valid/invalid input, duplicates, missing records, conflict handling, and stable error envelopes.
- **Frontend tests:** critical component behavior, loading/empty/error states, accessibility, and responsive behavior.
- **End-to-end tests:** critical happy and failure paths from onboarding through purchase/receive, checkout, history, analytics, and persisted AI insight.
- **Analytics tests:** fixed fixtures with hand-verifiable expected values, time boundaries, empty/insufficient data, aggregation, and forecast evaluation.
- **Security tests:** cross-organization and unauthorized-branch access must fail without leaking data.

Do not replace database/concurrency tests with mocks when the risk is in transaction or isolation behavior.

## 14. Commands and environment setup

Prerequisites are Node.js 24 LTS and pnpm 11.19.0. These repository-root commands are verified:

```powershell
pnpm install --frozen-lockfile
pnpm list --recursive --depth -1
pnpm build
pnpm dev:api
pnpm dev:web
pnpm format
pnpm format:check
pnpm lint
pnpm start:api
pnpm start:web
pnpm test
pnpm test:db
pnpm test:watch
pnpm typecheck
```

The first command installs every current workspace from the committed lockfile without permitting lockfile changes. The second lists the private `stockwise` root plus `@stockwise/api` and `@stockwise/web`. `pnpm build` builds every workspace package that exposes a build script. `pnpm dev:api` runs the TypeScript API entry with Node.js watch mode, and `pnpm start:api` serves the compiled API; both require `STOCKWISE_API_PORT` and server-only `DATABASE_URL`, and bind only to `127.0.0.1`. `pnpm dev:web` and `pnpm start:web` use fixed port `3000`; Next.js loads the root `.env` when present and requires its server-only `STOCKWISE_API_ORIGIN` to configure the local health rewrite. `pnpm format` writes Prettier formatting for applicable non-generated, non-Markdown files; `pnpm format:check` checks the same scope without writing. `pnpm lint` runs the shared ESLint correctness rules plus Next.js Core Web Vitals rules for `apps/web`. `pnpm test` and `pnpm test:watch` regenerate the API Prisma client first, then provision the guarded `TEST_DATABASE_URL`, apply committed migrations with `prisma migrate deploy`, reset its data, and run Vitest with one-shot and interactive behavior respectively. Both discover root and workspace `*.test.ts`/`*.test.tsx` files, while future cross-application tests under `tests/e2e` remain excluded for their dedicated runner. `pnpm test:db` applies the same migrations and runs only the database harness tests. `pnpm typecheck` validates root tooling input, generates Next.js route types, regenerates the API Prisma client, and runs strict API/web package TypeScript validation.

The web and API packages expose verified package-scoped `lint`, `test`, `typecheck`, and `build` scripts. The API package additionally exposes package-scoped `dev`, `start`, `test:db`, `prisma:generate`, `prisma:validate`, `prisma:migrate:dev`, and `prisma:connectivity-check` scripts. `prisma:migrate:dev` requires a caller-supplied migration name and a populated local `DATABASE_URL`; migration SQL must be reviewed before application. The last command executes only a non-domain `SELECT 1` query and requires that same local URL.

For the local PostgreSQL development baseline, install Docker Desktop or Docker Engine with Docker Compose. Copy `.env.example` to `.env`, replace every `STOCKWISE_POSTGRES_*` placeholder with unique non-production local values, then use these verified commands:

```powershell
docker compose config --quiet
docker compose up --detach postgres
docker compose ps
docker compose exec --no-TTY postgres psql --username <local-user> --dbname <local-database> --command "SELECT 1;"
docker compose down
```

`compose.yaml` uses the fixed `postgres:16.11-alpine` image, exposes PostgreSQL only on `127.0.0.1:$STOCKWISE_POSTGRES_PORT`, and persists cluster data in the named `stockwise-postgres-data` volume. `docker compose down` removes the development container and network but preserves that volume; do not add `--volumes` unless local data deletion is explicitly intended. This is local development infrastructure only, not a production deployment. Docker Engine 29.7.2 and Docker Compose 5.4.0 validated the baseline on 2026-08-22.

The Phase 1 foundation tasks collectively must establish exact root commands, strict TypeScript, linting, formatting, test baseline, safe environment examples, and verified documentation. Keep the tasks bounded as defined in `PROJECT_PLAN.md`.

`P1-M1-T01 — Repository Foundation & Tooling` established only the approved workspace/package-manager root, lockfile, repository conventions, and ignore policy after resolving `OQ-001`. It did not initialize Next.js or include TypeScript/lint/format configuration, test-runner setup, `.env.example`, Express, Prisma, PostgreSQL/Docker, authentication, domain logic, AWS resources, analytics, or AI; those belong to later Phase 1 tasks.

`P1-M1-T02 — TypeScript and code-quality baseline` established the shared strict TypeScript policy, ESLint correctness rules, Prettier formatting policy, and the verified root quality commands above. It did not add an application shell, test runner, environment contract, database, domain, or infrastructure implementation.

`P1-M1-T03 — Test baseline and root test scripts` established Vitest, the verified one-shot `pnpm test` command, an interactive `pnpm test:watch` script, reusable root discovery configuration, and one non-domain smoke test. It did not add coverage tooling, browser/DOM testing, end-to-end tooling, an application shell, an environment contract, database, domain, or infrastructure implementation.

`P1-M1-T05 — CI quality gates` established one least-privilege GitHub Actions workflow for pushes and pull requests. On Ubuntu 24.04 with Node.js 24.19.0 and pnpm 11.19.0, it performs a frozen-lockfile install followed by the existing `format:check`, `lint`, `typecheck`, and `test` scripts. `P1-M2-T01` adds the verified root `build` gate after tests. `P1-M3-T03` adds one ephemeral PostgreSQL 16.11 test service and test-only `TEST_DATABASE_URL` because the suite now includes guarded database tests. The workflow uses immutable action commit pins and adds no cache, matrix, secret, deployment, or release behavior.

`P1-M2-T01 — Next.js web shell` resolved `OQ-002` through `ADR-012` and established `apps/web` with the App Router under `src/app`, Server Components by default, one narrow TanStack Query Client Component provider, Tailwind CSS, shadcn/ui initialization metadata, an accessible responsive shell, and a web-owned empty Zod environment boundary. It adds no feature routes, Next.js Route Handlers, authentication, API implementation, database, domain behavior, or infrastructure.

`P1-M2-T02 — Express API shell` established `apps/api` with an Express app factory, empty `/api/v1` router boundary, ordered request-ID/logging and JSON middleware, safe 404/JSON/error envelopes, idempotent HTTP server shutdown, signal handling, Pino structured logs, and an API-owned empty Zod environment boundary. It adds no endpoint, health/readiness probe, domain-module directory, authentication, database, web integration, or infrastructure.

`P1-M2-T03 — Health and Readiness Endpoints` established root-level `GET /health` and `GET /ready` operational probes. Health returns only `{"status":"ok"}` when the API process can handle requests. Readiness returns only `{"status":"ready"}` when all configured required dependencies are ready, otherwise `503 {"status":"not_ready"}`; it never exposes dependency identity or failure details. With no required external dependency yet, readiness defaults to ready. Frozen install, format-check, lint, strict typecheck, 18 root tests/14 API tests, API/web builds, and a compiled-API HTTP smoke were verified on 2026-08-22. It adds no business API, web integration, database, domain module, authentication, Docker, or infrastructure.

`P1-M2-T04 — Web-to-API development path` established `STOCKWISE_API_PORT=3001` for the API loopback listener and server-only `STOCKWISE_API_ORIGIN=http://127.0.0.1:3001` for the Next.js rewrite. The browser requests same-origin `GET /api/health`; Next.js proxies it to Express `GET /health`. Express enables no CORS policy for this path and emits no cross-origin permission header. The web shell contains one narrow typed health client/view only; business REST APIs remain Express-owned under `/api/v1`. Frozen install, format-check, lint, strict typecheck, 24 tests, builds, dev/start HTTP proxy smokes, direct-origin header checks, and desktop-browser responsive smoke at 375px passed on 2026-08-22. It adds no business API, database, domain module, authentication, Docker, or infrastructure.

`P1-M3-T01 — Local PostgreSQL and Docker setup` established `compose.yaml` with a development-only PostgreSQL 16.11 container, `pg_isready` healthcheck, loopback-only host port, and named persistent volume. It establishes only Docker-owned `STOCKWISE_POSTGRES_USER`, `STOCKWISE_POSTGRES_PASSWORD`, `STOCKWISE_POSTGRES_DATABASE`, and `STOCKWISE_POSTGRES_PORT` local configuration. Compose validation, clean-start health, loopback/connectivity smoke, restart persistence, and non-destructive teardown were verified on 2026-08-22. It adds no Prisma dependency, schema, migration, database table, API database access, production deployment, or test harness.

`P1-M3-T02 — Prisma foundation` added Prisma ORM 7.9.1 to `apps/api` with the PostgreSQL `pg` driver adapter, API-owned `prisma.config.ts`, an empty PostgreSQL datasource/generator schema, and a lazy per-process Prisma client. `DATABASE_URL` is required and PostgreSQL-scheme validated only at the API boundary; it is not part of web configuration. Generated client output is ignored at `apps/api/src/generated/prisma/` and regenerated by API/root test, typecheck, and build commands; future migrations remain reviewable under `apps/api/prisma/migrations/`. Prisma generate/validate, a disposable `migrate dev` no-op, and a local PostgreSQL `SELECT 1` smoke passed on 2026-08-22. No model, business table, or migration was created.

`P1-M3-T03 — Database test harness` added API-owned, server-only test configuration and helpers without a model, business table, or migration. `TEST_DATABASE_URL` must be a loopback PostgreSQL URL whose database name ends in `_test`; it must differ from runtime `DATABASE_URL`. The harness validates that target before provisioning or cleanup, creates the disposable test database through local `postgres` when absent, truncates only its public-schema data while retaining Prisma migration metadata, removes only its own scratch schema, and runs teardown cleanup. Vitest serializes files because they share that resettable target; the helper also supports intentional rollback transactions. Focused tests verified the connection, invalid/non-loopback/equal URL rejection, direct reset guard, cleanup, rollback, and repeated execution against a separate local Compose project on `127.0.0.1:5433`; the full suite and CI use the same test-only contract. No domain migration was applied.

`P2-M1-T02 — Identity and tenancy schema` added UUID/snake-case Prisma models for users, organizations, branches, organization memberships, role-less branch assignments, hash-only PostgreSQL sessions and one-time tokens, email-bound invitations, and invitation branch scopes. Composite foreign keys enforce same-organization membership/branch and invitation/branch references; accepted invitations also bind the accepted user ID to the normalized invited email. All identity/tenancy foreign keys use restrictive update/delete actions. SQL checks and partial indexes enforce canonical emails, lifecycle/time ordering, hash/relationship uniqueness, and replacement-safe open verification/invitation records. The harness now applies committed migrations before resetting data. The last-active-OWNER, role/assignment compatibility, onboarding, and acceptance invariants remain assigned to later application transactions/policy as documented in `docs/DATABASE.md`. The 2026-08-24 forward correction makes only `User.displayName` nullable until profile/onboarding and preserves the nonblank check for present values; it does not modify initial migration history. Incremental existing-row and clean zero-to-latest PostgreSQL 16.11 migration paths, Prisma format/validate/generate, 13 schema tests, the 174-test suite, 4 focused harness tests, format-check, lint, strict typecheck, API/web builds, production audit, and diff review passed. It adds no authentication service, endpoint, Argon2 dependency, registration behavior, UI, authorization policy implementation, or later-domain model.

`P2-M1-T03 — Authorization policy foundation` added `apps/api/src/modules/identity/authorization-policy.ts`, the pure centralized permission evaluator and its 132-test unit matrix. It defines fixed typed capability names, private-branded context/scope values derived from server-resolved actor, membership, assignment, and resource ownership state, and deny-by-default organization/branch evaluation without a database query. `OWNER`/`ADMIN` have organization-wide scope; branch-only roles require active explicit assignments. OWNER-only governance remains distinct from ADMIN non-owner membership administration, and refund/void is deliberately absent pending `OQ-009`. It does not add an auth service, session middleware, endpoint, UI, Prisma model, or migration. Frozen install, format-check, lint, strict typecheck, 173 full tests, 4 harness tests, API/web builds, production audit, and diff review passed on 2026-08-24 using a removed-after-verification disposable loopback PostgreSQL Compose project.

`P2-M2-T01 — Registration and Argon2` added public `POST /api/v1/auth/register` with strict email/password-only Zod validation, surrounding-whitespace-trimmed lowercase canonical email, exact 15–128 Unicode-code-point password handling, `argon2@0.45.1` Argon2id PHC verifiers (`memoryCost=65536`, `timeCost=3`, `parallelism=4`), and a deterministic five-per-15-minute process-local limiter keyed by a SHA-256 derivative of canonical email. Valid permitted attempts use one hash-and-create path with no existence pre-read; PostgreSQL uniqueness is authoritative and the Prisma 7 driver-adapter email conflict is translated to the same generic `202` response as a new row. New rows remain unverified with null display name and create no token, email, session, organization, or branch. The accepted-config Argon2 smoke completed in approximately 44 ms on the verification host; this is compatibility evidence, not a production latency target. Frozen install, format-check, lint, strict typecheck, 163 focused identity/registration tests, 205 full tests, 4 harness tests, API/web builds, production audit, and diff review passed on 2026-08-24 against an isolated disposable PostgreSQL 16.11 Compose project.

`P2-M2-T02 — Login and authenticated context` added public `POST /api/v1/auth/login`, the separate accepted login-failure limiter, fixed-dummy Argon2 enumeration mitigation, CSPRNG/SHA-256 session-token boundary, atomic collision-safe PostgreSQL session creation/rotation, the production-aware `stockwise_session` cookie, sliding idle/fixed absolute expiry with bounded persisted touches, and a private-branded Express authentication context containing active verified actor/session identity only. Login returns exactly safe `id`/`email`/nullable `displayName` actor data and no authorization state. No logout, verification/provider, recovery, onboarding, UI, authorization endpoint wiring, model, or migration was added. Frozen install, format-check, lint, strict typecheck, 56 focused tests, 262 full tests, 4 harness tests, API/web builds, production audit, STRIDE/leakage review, and diff checks passed on 2026-08-24 against an isolated removed-after-verification PostgreSQL 16.11 environment.

`P2-M2-T03 — Logout, verification, and credential recovery` added safely idempotent current-session logout, authenticated all-session logout, verification resend/initial issuance and atomic completion, account-safe password-reset request and atomic completion, provider-abstracted production Resend/development non-delivery/test recording adapters, 32-byte hash-only 24-hour/30-minute tokens, row-serialized replacement, provider-failure compensation, and the narrow independent three-per-15-minute process-local resend/reset-request limiters accepted by `ADR-018`. Reset validates token state before centralized Argon2 and atomically consumes the token, changes the password, and revokes all sessions without creating a new one. The reviewed schema/migrations were sufficient; no model or migration changed. Frozen install, format-check, lint, strict typecheck, 298 full tests, 4 harness tests, API/web builds, production audit, STRIDE/authored-source secret/leakage review, and diff checks passed on 2026-08-24 against an isolated disposable PostgreSQL 16.11 project. `OQ-020` remains open beyond its four narrow application-level limiter exceptions.

Across the later foundation/application-shell tasks:

1. `OQ-002` is resolved by `ADR-012`; preserve the App Router, `src/app`, Server Component default, and Express-owned business API boundary.
2. Add exact root commands only as their tooling genuinely exists.
3. Add an `.env.example` containing variable names and safe descriptions only in the environment-contract task.
4. Validate environment input with Zod when the owning process boundary exists.
5. Update this section with commands actually executed successfully; do not document guessed commands.

### Environment and configuration contract

`P1-M1-T04 — Environment example and validation contract` established the root `.env.example` ownership and handling contract. Exact names and values are added only when an owning process or infrastructure task exists and its blockers are resolved.

- `apps/web` owns browser/build-time configuration. Its current Zod schema requires `STOCKWISE_API_ORIGIN`, which `next.config.ts` reads from the root `.env` only to configure the local same-origin health rewrite. It is not public client configuration. Tenant scope, trusted prices/totals, credentials, database settings, provider keys, and cloud secrets are never client configuration.
- `apps/api` owns server-only runtime configuration, including `STOCKWISE_API_PORT` and future PostgreSQL, authentication, OpenRouter, and cloud settings. Server-only values must not be exposed through web configuration, logs, errors, health endpoints, screenshots, analytics snapshots, or AI prompts.
- Each process validates only its own environment with a process-owned Zod schema at startup. Separate strict empty Next.js and Express schemas and tests exist; there is no speculative shared root schema.
- Local development values must be non-production and documented by the task that introduces the corresponding process or resource. Test values must identify isolated, disposable resources and must never target shared, staging, or production data.
- Populated `.env` and `.env.*` files remain ignored. Only redacted example files may be committed. Never place real secrets, tokens, credentials, or production values in an example.
- `P1-M2-T04` owns the verified local port/origin contract: `STOCKWISE_API_PORT=3001`, `STOCKWISE_API_ORIGIN=http://127.0.0.1:3001`, and fixed web port `3000`. `P1-M3-T01` owns the Docker-only local PostgreSQL inputs `STOCKWISE_POSTGRES_USER`, `STOCKWISE_POSTGRES_PASSWORD`, `STOCKWISE_POSTGRES_DATABASE`, and `STOCKWISE_POSTGRES_PORT`; they are non-production values, are never browser configuration, and require a unique replacement in a populated local `.env`. `P1-M3-T02` owns the API-only `DATABASE_URL`, which connects to that loopback database, is PostgreSQL-scheme validated by the API Zod boundary, and must never be web or `NEXT_PUBLIC_` configuration. P1-M3-T03 owns the server-only `TEST_DATABASE_URL`; the test harness accepts only an isolated loopback `*_test` target that differs from `DATABASE_URL`, and this value is never web configuration. P2-M2-T03 owns API-only `STOCKWISE_PUBLIC_WEB_ORIGIN`; production-only `STOCKWISE_EMAIL_FROM` and `RESEND_API_KEY`; and runtime-selected Resend/non-delivery behavior. None is browser or `NEXT_PUBLIC_` configuration. Reporting/schedule/provider settings remain with `OQ-016`–`OQ-018`/Phase 7; AWS topology/secret management remains `OQ-015`/`OQ-020`/Phase 8.

P1-M1-T04 added no runtime validation before a process existed. P1-M2-T04 updates the web and API schemas with the only concrete local integration values; both schemas select only their owned input and reject missing, invalid, and unowned values. P1-M3-T03 adds a distinct test-only environment boundary for the database harness. All remaining configuration stays assigned to later tasks or decisions.

## 15. What agents may change

Within an explicitly assigned implementation task, agents may:

- Inspect the repository and relevant documentation.
- Create a short implementation plan.
- Change files directly required by the approved scope.
- Add focused tests and update affected Source of Truth documents.
- Run safe local checks against confirmed disposable/local resources.
- Report blocking questions, inconsistencies, and risks.

## 16. What agents must not change without explicit approval

- Product scope, roles, business rules, analytics formulas, or accepted architecture
- Answers to any `OQ-*` item
- The core tech stack or cloud topology
- Tenant, branch, authorization, stock-ledger, transaction, history, or money invariants
- Database schemas or migrations outside the assigned task
- Dependencies unrelated to the assigned task
- Secrets, credentials, production data, cloud resources, access controls, or broad filesystem permissions
- Unrelated code, formatting churn, generated artifacts, or lockfiles
- Git history or remote state

If a requested implementation cannot be completed without one of these changes, stop at the boundary, explain the evidence and impact, and ask for a decision.

## 17. Git identity, attribution, and remote actions

- Treat Codex as a coding tool, never as an author, committer, co-author, contributor, or signatory.
- Never add `Codex`, `OpenAI`, an AI agent, or a bot to authorship, trailers, contributor files, changelogs, pull-request attribution, or release attribution.
- Never add `Co-authored-by`, `Generated-by`, or similar AI attribution.
- Do not create a commit, amend, push, open a pull request, merge, tag, or release unless the user explicitly asks for that exact action.
- Before every authorized commit, verify that `user.name` resolves exactly to `67070194` and `user.email` resolves exactly to `67070194@kmitl.ac.th`; stop if either differs.
- Use only the user's authenticated Git hosting account for remote actions.

Finishing tests means a change is **ready for commit**; it does not authorize a commit.

## 18. Task workflow

Use this sequence for each implementation task:

1. **READ** — inspect this guide, relevant specs, repository state, existing code, and tests.
2. **PLAN** — state files/components, data/API effects, dependencies, security, tests, and order.
3. **IMPLEMENT** — make only approved, focused changes.
4. **TEST** — run relevant automated checks and inspect failures.
5. **REVIEW** — check correctness, security, validation, authorization, edge cases, architecture, and unnecessary changes.
6. **FIX** — resolve issues found within scope.
7. **TEST AGAIN** — rerun affected checks.
8. **HANDOFF** — report summary, files, checks, remaining issues, and whether the work is ready for commit.

Use one focused task/thread per coherent feature or bounded group. Do not ask one thread to build the entire project.

## 19. Definition of Done

A task is done only when all applicable statements are true:

- Scope and acceptance criteria are satisfied without silently answering Open Questions.
- Architecture, tenant/branch rules, security, stock, history, and money invariants are preserved.
- Input validation and authorization cover happy, invalid, missing, duplicate, forbidden, cross-tenant, and dependency-failure cases.
- Relevant unit, integration, end-to-end, concurrency, analytics, security, lint, format, typecheck, and build checks pass.
- No secrets, personal data, unrelated changes, unsafe casts, dead code, or unexplained dependencies were added.
- Schema changes include reviewed migrations and safe rollout/recovery notes where applicable.
- Affected Source of Truth documents and plan status are updated together.
- The final handoff lists changes, files, checks with results, and unresolved decisions.
- The work is only reported as ready for commit unless the user separately authorizes the exact Git action.
