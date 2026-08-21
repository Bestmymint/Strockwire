# StockWise Agent Guide

This file is the execution contract for human and AI developers working in the `stockwise` repository. Read it before every task.

| Field | Value |
| --- | --- |
| Documentation baseline | Architecture Freeze v1 |
| Last updated | 2026-08-22 |

## 1. Project overview

StockWise is a responsive, cloud-based retail platform for SMEs. It covers organization-level product and supplier management; branch-level inventory, purchasing/receiving, POS, and sales; deterministic analytics and forecasting; and scheduled aggregate summaries through OpenRouter.

The repository is in a **repository-foundation, pre-application state**. The pnpm workspace root and non-domain test baseline exist, but no web/API application, schema, environment contract, or infrastructure implementation exists. Do not treat later planned directories, commands, schemas, or endpoints as existing code.

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

- Identity/onboarding/authorization: `OQ-003`, `OQ-005`, `OQ-022`
- Inventory and quantity mutations: `OQ-007`, `OQ-023`
- POS/sales monetary behavior: `OQ-007`, `OQ-008`, `OQ-010`, `OQ-022`, `OQ-023`
- Refund/void behavior: `OQ-009` in addition to the sales decisions
- Purchasing/receiving costing behavior: `OQ-007`, `OQ-010`, `OQ-023`
- Analytics and forecasting: `OQ-011`, `OQ-012`; plus any metric-specific dependency documented in `docs/ANALYTICS.md`

The accepted MVP role names are `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`. These names do not grant permissions by themselves. `OQ-022` remains open for the exact organization/branch permission matrix, delegation, membership administration, operational actions, cost/margin visibility, organization-wide analytics, and last-owner governance.

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

The root package-manager, code-quality, and test foundation exists:

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
.gitignore
.gitattributes
tsconfig.base.json
tsconfig.json
eslint.config.mjs
prettier.config.mts
.prettierignore
vitest.config.mts
test/smoke.test.ts
```

There is no application scaffold, environment contract, Prisma schema, or Docker setup in this workspace yet.

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

- Hash passwords with Argon2. Never log, return, or persist plaintext passwords.
- Do not invent token storage or refresh behavior; `OQ-003` blocks authentication implementation.
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
pnpm format
pnpm format:check
pnpm lint
pnpm test
pnpm typecheck
```

The first command installs every current workspace from the committed lockfile without permitting lockfile changes. The second lists discovered workspace packages; until application tasks create child packages, only the private `stockwise` root is present. `pnpm format` writes Prettier formatting for applicable non-generated, non-Markdown files; `pnpm format:check` checks the same scope without writing. `pnpm lint` runs the shared ESLint correctness rules. `pnpm test` runs Vitest once and fails when no matching tests are discovered; root and workspace unit/integration tests use `*.test.ts` or `*.test.tsx`, while future cross-application tests under `tests/e2e` are excluded for their later dedicated runner. `pnpm typecheck` validates the root TypeScript configuration and its current tooling input; future application packages must extend `tsconfig.base.json` and update the root typecheck orchestration when those packages exist.

No application scaffold, environment schema, build, migration, or development commands exist yet.

The Phase 1 foundation tasks collectively must establish exact root commands, strict TypeScript, linting, formatting, test baseline, safe environment examples, and verified documentation. Keep the tasks bounded as defined in `PROJECT_PLAN.md`.

`P1-M1-T01 — Repository Foundation & Tooling` established only the approved workspace/package-manager root, lockfile, repository conventions, and ignore policy after resolving `OQ-001`. It did not initialize Next.js or include TypeScript/lint/format configuration, test-runner setup, `.env.example`, Express, Prisma, PostgreSQL/Docker, authentication, domain logic, AWS resources, analytics, or AI; those belong to later Phase 1 tasks.

`P1-M1-T02 — TypeScript and code-quality baseline` established the shared strict TypeScript policy, ESLint correctness rules, Prettier formatting policy, and the verified root quality commands above. It did not add an application shell, test runner, environment contract, database, domain, or infrastructure implementation.

`P1-M1-T03 — Test baseline and root test scripts` established Vitest, the verified one-shot `pnpm test` command, an interactive `pnpm test:watch` script, reusable root discovery configuration, and one non-domain smoke test. It did not add coverage tooling, browser/DOM testing, end-to-end tooling, an application shell, an environment contract, database, domain, or infrastructure implementation.

Across the later foundation/application-shell tasks:

1. Resolve `OQ-002` before the Next.js shell task, not before `P1-M1-T01`.
2. Add exact root commands only as their tooling genuinely exists.
3. Add an `.env.example` containing variable names and safe descriptions only in the environment-contract task.
4. Validate environment input with Zod when the owning process boundary exists.
5. Update this section with commands actually executed successfully; do not document guessed commands.

Expected environment categories, not final variable names:

- PostgreSQL connection information
- Authentication secrets/settings after `OQ-003`
- Application origins/ports
- OpenRouter key/model settings after `OQ-018`
- AWS settings only when cloud implementation begins

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
