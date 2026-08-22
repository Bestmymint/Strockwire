# StockWise Architecture Decision Log

| Field | Value |
| --- | --- |
| Status | Accepted decision history |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-22 |

## 1. Log rules

- This file records why durable decisions were made and their consequences.
- Current product/system definitions remain in their topic-owned Source of Truth documents.
- Do not rewrite an accepted ADR to hide a later change. Add a new ADR, mark the old one `Superseded by ADR-*`, and update every affected current document in the same change.
- Open Questions are tracked only in `BUILD_SPEC.md`; an unresolved question is not an ADR.
- Status values: `Accepted`, `Superseded`, `Deprecated`, `Proposed`.

## ADR-001 — Use Express.js and TypeScript instead of FastAPI/Python

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Architecture

### Context

An earlier direction considered Python/FastAPI because analytics and machine-learning experiments were expected to be a central backend responsibility. The current product boundary changed: deterministic analytics and forecasting are application/database logic, while the external LLM only summarizes precomputed aggregates. A Python ML service is not required now.

### Alternatives considered

1. FastAPI/Python for the entire backend
2. TypeScript backend plus a separate Python analytics/ML service
3. Express.js + TypeScript backend, with PostgreSQL/TypeScript analytics

### Decision

Use **Express.js + TypeScript** for the backend. Use Next.js + TypeScript for the frontend. Do not use FastAPI, Python, or a separate ML service in the current baseline.

### Why selected

- One primary language reduces tooling, deployment, validation, and maintenance overhead.
- The current analytics/forecast scope does not justify Python-specific runtime complexity.
- Express is sufficient for the REST/application workload and allows explicit modular boundaries.
- It avoids authentication, networking, logging, and versioning between two backends.

### Consequences

- Analytics and Forecasting V1 must be implementable/testable in TypeScript and SQL.
- A future Python service requires measured need and a superseding ADR.
- Express provides less opinionated structure, so `AGENTS.md` and architecture rules must enforce thin controllers, domain modules, validation, and error handling.

## ADR-002 — Start with a modular monolith

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Architecture

### Context

StockWise has several domains but a small project/team and multiple workflows requiring strong database transactions. Independent deployment/ownership needs have not been demonstrated.

### Alternatives considered

1. Unstructured monolith
2. Modular monolith
3. Microservices from the start

### Decision

Build one Express deployable as a **modular monolith** with explicit identity, tenancy, catalog, inventory, purchasing, sales, analytics, and AI-insight boundaries.

### Why selected

- Minimizes operational and distributed-system overhead.
- Supports atomic checkout and receiving in one PostgreSQL transaction.
- Keeps domain boundaries reviewable without premature service extraction.
- Fits incremental MVP delivery.

### Consequences

- Modules cannot freely import one another's internals.
- Cross-domain workflows use explicit application contracts/use cases.
- No internal HTTP calls between modules.
- Microservices require evidence such as independent scaling/deployment/team ownership and a superseding ADR.

## ADR-003 — Model tenancy as Organization -> Branch

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Product and architecture

### Context

The target includes both small shops and SME retailers with multiple branches. Adding branches later would force changes to ownership, authorization, inventory, sales, purchasing, and analytics.

### Alternatives considered

1. Single-store system with branch added later
2. One account/database per branch
3. Organization tenant with branch operational scopes

### Decision

Use this hierarchy from the beginning:

```text
Organization (tenant)
  -> Branch (operation)
```

- Products, categories, and suppliers are organization-level.
- Inventory, sales/POS, purchase orders, and receiving are branch-level.
- A user can access multiple branches through organization and/or branch memberships.
- Authorization is RBAC plus branch scope.

### Why selected

- Matches real multi-branch ownership without separate accounts.
- Allows organization-wide catalog governance and branch-specific operational stock/sales.
- Prevents a later tenancy retrofit across every domain.

### Consequences

- Every business query must be tenant-scoped; branch operations also verify branch scope.
- `user.branchId` alone is an invalid complete membership model.
- Cross-tenant references must be prevented by scoped queries and data constraints.
- Organization analytics can aggregate only authorized branches.
- The fixed MVP RBAC and branch-assignment rules are defined by `ADR-016`.

## ADR-004 — Use PostgreSQL with Prisma

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Architecture and implementation baseline

### Context

StockWise needs relational ownership, uniqueness, referential integrity, precise money, transactions, concurrency controls, historical ledgers, and analytical SQL.

### Alternatives considered

1. PostgreSQL + Prisma
2. MySQL or another relational database
3. Document/NoSQL primary database
4. Multiple databases per domain

### Decision

Use **PostgreSQL** as the single primary system of record and **Prisma** for TypeScript data access and forward migrations.

### Why selected

- ACID transactions support checkout and receiving invariants.
- Relational constraints match organization/branch/resource ownership.
- `NUMERIC` supports precise monetary values.
- PostgreSQL query/index capabilities support operational access and analytics.
- Prisma aligns with the TypeScript stack and provides a reviewable schema/migration workflow.

### Consequences

- Database constraints remain necessary even with Zod/Prisma validation.
- Concurrency-sensitive flows may need explicit PostgreSQL locking/SQL behavior beyond simple ORM CRUD.
- Generated migrations require SQL review; applied migrations are not rewritten.
- Production uses Amazon RDS for PostgreSQL under ADR-009.

## ADR-005 — Use an inventory ledger plus current balance projection

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Data architecture

### Context

A single mutable product stock number cannot explain changes, reconcile errors, or support safe purchasing/sales history. Reads also need a fast current balance.

### Alternatives considered

1. Store only `product.stock`
2. Derive current stock by summing the full ledger on every request
3. Append-oriented transaction ledger plus transactionally maintained balance

### Decision

Use `InventoryTransaction` as the traceable movement history and `InventoryBalance` as the current branch/product projection. Every stock mutation writes both atomically.

### Why selected

- Provides a reason/source for each change.
- Keeps current stock reads efficient.
- Supports reconciliation, audit investigation, and compensating corrections.
- Works with atomic checkout and receiving.

### Consequences

- Direct/unexplained balance overwrites are prohibited.
- Corrections append compensating movements rather than edit/delete ledger history.
- Concurrency and reconciliation tests are mandatory.
- Negative-stock behavior remains `OQ-007`; transfer/refund movement lifecycles remain unresolved.

## ADR-006 — Compute analytics and forecasts in TypeScript/SQL

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Architecture

### Context

Analytics values must be reproducible, testable, tenant-scoped, and explainable. Asking an LLM to derive values would make results non-deterministic and unsafe. A separate Python service is not justified for Forecasting V1.

### Alternatives considered

1. Let an LLM calculate analytics/forecast values
2. Build a Python/ML service now
3. Calculate accepted formulas using PostgreSQL SQL and TypeScript

### Decision

Use PostgreSQL SQL and TypeScript for metrics, period comparisons, classifications, forecasting, evaluation, and reorder recommendations. `docs/ANALYTICS.md` is the sole formula contract.

### Why selected

- Results are deterministic and fixture-testable.
- Queries can enforce tenant/branch scope close to data.
- Avoids a second runtime/service before its value is proven.
- Keeps model/metric versions and inputs explainable.

### Consequences

- Exact formulas and Forecasting V1 must close `OQ-011`/`OQ-012` before implementation.
- Forecast experiments compare a named baseline using accepted reproducible metrics.
- Introducing Python/ML later requires measured improvement and a superseding ADR.

## ADR-007 — Use OpenRouter only for scheduled aggregate summaries

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Product, architecture, and security

### Context

Owners benefit from a plain-language explanation of many analytics outputs, but per-page or per-user generation is costly, slow, inconsistent, and unnecessary. The LLM must not be numerical truth or receive sensitive raw data.

### Alternatives considered

1. No LLM
2. On-demand chatbot/report generation
3. LLM as forecast/recommendation engine
4. Scheduled summary of precomputed aggregate snapshots

### Decision

Use **OpenRouter API** only to summarize versioned aggregate analytics snapshots on **daily, weekly, monthly, and yearly** schedules. Persist results; dashboards read stored content. Do not call OpenRouter on page views or user actions.

### Why selected

- Separates deterministic business truth from probabilistic language generation.
- Controls cost/rate and avoids repeated calls on dashboard traffic.
- Enables reviewable data minimization.
- Core retail operations remain available during provider outage.

### Consequences

- Snapshot, prompt, provider/model, and output provenance are versioned.
- No customer/employee personal data or raw transaction rows are sent.
- Provider failure produces a safe failed/stale state and never blocks operational workflows.
- EventBridge is the production schedule trigger; exact times/model/fallback/budget remain `OQ-017`/`OQ-018`.
- OpenRouter is not a forecast engine, arithmetic service, database client, stock decision maker, or real-time chatbot.

## ADR-008 — Use versioned REST APIs

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Architecture

### Context

The Next.js client needs an explicit boundary to the Express backend. The domain is resource/action oriented, and no need for GraphQL complexity has been demonstrated.

### Alternatives considered

1. REST
2. GraphQL
3. Direct server/database coupling from the web app

### Decision

Use JSON REST endpoints under `/api/v1`, validated with Zod and protected by server-side authentication, RBAC, and tenant/branch scope.

### Why selected

- Clear HTTP/resource semantics and straightforward testing/documentation.
- Fits Express and the current product surface.
- Avoids introducing a second query/schema paradigm without need.

### Consequences

- Use consistent success/error envelopes, pagination, status/error mapping, and idempotency.
- Breaking contract changes require deliberate versioning/migration.
- Browser authentication uses the opaque-session and cookie contract in `ADR-013`; REST endpoints must not expose a bearer or refresh-token alternative.

## ADR-009 — Use an AWS baseline without fixing the exact hosting topology yet

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Cloud architecture

### Context

StockWise is a cloud/software-engineering project and must include deployment, monitoring, experimentation, limitations, and cost analysis. The exact frontend/backend compute and production topology have not been selected.

### Alternatives considered

1. Local-only deployment
2. AWS building-block baseline with topology selected later
3. Kubernetes/microservices platform from the start
4. A different cloud provider

### Decision

Use these AWS capabilities:

- RDS PostgreSQL
- S3 for accepted object-storage needs
- VPC network isolation
- CloudWatch logs/metrics/alerts
- EventBridge schedules
- Docker application packaging
- GitHub Actions CI/CD
- SQS only when measured job/backpressure complexity requires it

Leave exact frontend/backend compute, ingress, region, secrets, IaC, availability, recovery, and cost targets to `OQ-015`/`OQ-020`.

### Why selected

- Meets the cloud-delivery and experiment goals with managed foundational services.
- Avoids pretending that an unreviewed topology is already accepted.
- Keeps optional queue/service complexity evidence-driven.

### Consequences

- Documentation may show only a conceptual deployment until `OQ-015` closes.
- RDS is intended to be privately networked and protected by least privilege.
- Cloud changes require reviewable infrastructure as code after tooling is selected.
- S3 endpoints/assets are not added without a defined product need and security/lifecycle contract.
- Kubernetes and microservices remain non-goals.

## ADR-010 — Use email/password with Argon2 for MVP; defer Google login

- **Date:** 2026-08-21
- **Status:** Accepted
- **Type:** Product and security

### Context

Retail staff may not have suitable Google accounts, and the core project should not be blocked by OAuth provider setup. Email/password is required; Google login may be useful later as an option.

### Alternatives considered

1. Google-only authentication
2. Email/password plus Google immediately
3. Email/password MVP, optional Google after core completion
4. Managed identity service as an immediate replacement

### Decision

Implement email/password authentication for MVP and hash passwords with Argon2. Do not implement Google login now; revisit after the core project.

### Why selected

- Covers owner and employee accounts without external identity dependency.
- Keeps the MVP identity scope focused.
- Preserves Google as a later optional convenience rather than the only access path.

### Consequences

- Password storage, abuse prevention, verification/reset, and session security are StockWise responsibilities.
- Session, verification/reset, onboarding, and invitation implementation must follow `ADR-013`–`ADR-015` rather than introducing a second identity flow.
- Future Google login must map to the same profile/onboarding/membership model and requires a new accepted decision/update.

## ADR-011 — Use a native pnpm workspace monorepo

- **Date:** 2026-08-22
- **Status:** Accepted
- **Type:** Repository architecture and tooling

### Context

StockWise needs one repository for a Next.js web application, an Express modular-monolith API, and only those internal packages that later prove genuinely shareable. The repository foundation must support reproducible installation without initializing either application or adding a task runner prematurely.

### Alternatives considered

1. npm workspaces
2. pnpm workspaces
3. Yarn workspaces
4. pnpm plus a monorepo orchestrator such as Turborepo or Nx

### Decision

Use a native **pnpm workspace** on **Node.js 24 LTS**, with one root `pnpm-lock.yaml` and an exact pnpm version in the root `packageManager` field.

Use these workspace paths:

```text
apps/web
apps/api
packages/*
```

The API owns its domain modules and Prisma assets beneath `apps/api`; they are not separate deployable services or workspace packages. `packages/*` is reserved for deliberately shared internal packages with concrete consumers. Cross-application end-to-end tests and future infrastructure live outside package-manager workspaces. Do not add Turborepo, Nx, Lerna, Changesets, or another orchestration/release layer until measured repository needs justify it.

### Why selected

- pnpm provides native workspace discovery and a single shared lockfile.
- Strict dependency visibility reduces accidental reliance on undeclared transitive dependencies.
- The `workspace:` protocol can guarantee that intentional internal dependencies resolve locally.
- Frozen-lockfile installation supports reproducible local and future CI checks.
- The layout separates deployable applications without turning modular-monolith domains into services or packages.

### Consequences

- Root dependency installation and future CI use the pinned pnpm version and frozen lockfile.
- Application directories are created only by their assigned later tasks.
- Shared packages require a specific reuse case and must not become a generic `common`, `shared`, or `utils` dumping ground.
- A future monorepo task runner or release tool requires demonstrated need and a separately reviewed decision.

## ADR-012 — Use the Next.js App Router with `src/app`

- **Date:** 2026-08-22
- **Status:** Accepted
- **Type:** Frontend architecture

### Context

The frontend baseline selected Next.js but left its routing and layout convention unresolved under `OQ-002`. The web shell needs one durable convention before application routes, layouts, providers, and future user flows are created. StockWise also has a separate Express REST backend, so the frontend boundary must not accidentally become a second business API.

### Alternatives considered

1. Next.js Pages Router
2. Next.js App Router at the repository package root
3. Next.js App Router using the `src/app` directory convention
4. Mixing Pages Router and App Router

### Decision

Use the **Next.js App Router** with the **`src/app` directory convention**. Do not use the Pages Router.

React Server Components are the default. Add `"use client"` only when a component requires client-side state, effects, event handlers, browser APIs, or a client-only provider. Route Groups such as `(auth)` and `(app)` may be introduced later only when implemented routes justify them.

StockWise core and business REST APIs remain in the Express backend under `/api/v1`. Do not implement them as Next.js Route Handlers. The shell task creates no speculative routes or feature pages.

### Why selected

- App Router is the current Next.js routing model and supports nested layouts and Server Components directly.
- `src/app` keeps application source separate from package-level configuration and generated output.
- Server Components by default minimize unnecessary client JavaScript and make client boundaries explicit.
- Deferring Route Groups avoids encoding authentication or product navigation before those flows are accepted and implemented.
- Keeping business APIs in Express preserves the accepted REST boundary and prevents duplicated backend responsibilities.

### Consequences

- All application routes and layouts are created beneath `apps/web/src/app`.
- No `pages` directory or mixed-router convention is allowed.
- Client providers must be narrow explicit boundaries beneath a Server Component root layout.
- Route Groups are added only with the routes that need them.
- Next.js Route Handlers must not host StockWise business APIs; any future framework-specific handler needs a separately justified non-business purpose and review against the Express boundary.
- `OQ-002` is resolved and no longer blocks `P1-M2-T01`.

## ADR-013 — Use opaque PostgreSQL-backed browser sessions

- **Date:** 2026-08-22
- **Status:** Accepted
- **Type:** Security and application architecture

### Context

The MVP needs browser authentication that supports immediate revocation, disabled-user access loss, and a future deployment without a separate session infrastructure dependency. JWT browser authentication, browser token storage, and refresh-token flows would add exposure and lifecycle complexity without a current need.

### Alternatives considered

1. Browser JWT with refresh token
2. Opaque server-side session backed by PostgreSQL
3. Hosted identity/session service

### Decision

Use opaque server-side sessions backed by PostgreSQL for MVP. Generate a cryptographically random session token, send it only in an HttpOnly cookie, and persist only its cryptographic hash with the user, issue/last-use, idle/absolute expiry, and revocation state. The cookie is host-only (no `Domain` attribute), `SameSite=Lax`, and `Secure` in production. The idle-timeout baseline is 24 hours and the absolute-timeout baseline is seven days; both remain configuration values.

Do not use JWT for browser authentication, store tokens in `localStorage` or `sessionStorage`, or add a refresh-token flow. Rotate the session on successful authentication, revoke the current session on logout, support revoking every session for a user, and resolve authorization server-side on every protected request. Disabled or deauthorized users lose access when their request is evaluated.

### Why selected

- PostgreSQL is already the accepted durable system of record and makes revocation queryable for the MVP.
- Hash-only session-token storage limits the impact of a session-record disclosure.
- Opaque sessions make rotation, logout, all-session revocation, and membership/status revalidation direct.

### Consequences

- The identity schema must add an appropriately indexed, hash-only session record and expiry/revocation checks.
- Cookie-based state-changing endpoints need implementation-time cross-site-request protections; this ADR does not authorize an alternate credential transport.
- The API and web client must never return or persist a browser bearer token.

## ADR-014 — Use a provider-abstracted Resend email lifecycle

- **Date:** 2026-08-22
- **Status:** Accepted
- **Type:** Security and integration architecture

### Context

Email/password accounts require verification, safe password recovery, and invitation delivery. Production delivery must be replaceable without coupling identity-domain behavior to a specific provider, while local development and automated tests must not deliver real email.

### Alternatives considered

1. Direct Resend calls from identity use cases
2. Resend behind an email-provider abstraction with non-delivery/test adapters
3. AWS SES immediately

### Decision

Use Resend as the MVP production email adapter behind an email-provider abstraction. Local development and automated tests use non-delivery/test adapters. AWS SES may replace the production adapter later without changing identity-domain behavior.

Email verification, password reset, and invitations use opaque cryptographically random tokens whose cryptographic hash alone is stored. They are single use and expire after 24 hours, 30 minutes, and seven days respectively. Resending verification or reissuing an invitation invalidates the prior active token. Forgot-password responses never reveal whether an account exists; a successful reset revokes all existing sessions.

### Why selected

- The abstraction prevents provider concerns from leaking into identity rules.
- Hash-only, single-use, expiry-bound tokens limit replay and database-disclosure risk.
- Non-delivery adapters make local and automated verification deterministic and safe.

### Consequences

- Identity-domain code depends on the provider interface, never a Resend SDK directly.
- Token records require secure lookup, expiry, consumption, and replacement semantics.
- Provider failures must produce safe, non-disclosing responses and must be tested.

## ADR-015 — Require verified, minimal onboarding and invitation-led joining

- **Date:** 2026-08-22
- **Status:** Accepted
- **Type:** Product and data model

### Context

The MVP needs enough information to identify a platform user and create a first operational tenant without collecting speculative personal, legal, or billing data. New users and invited employees have different entry paths.

### Alternatives considered

1. Require broad personal, company, and billing registration data
2. Minimal verified registration plus organization/first-branch onboarding
3. Automatically create an organization for every registration or invitation

### Decision

Registration requires email, password, and email verification. The platform profile requires `displayName`; profile phone is optional. New-organization onboarding requires organization name and an initial branch name; branch phone and address are optional. The creator becomes `OWNER` in the atomic onboarding result.

User identity is platform-level. A user does not carry `branchId` as its complete access model; organization and branch access derive from memberships. Invited users do not automatically create an organization or account: they register/authenticate as the invited email, verify it, then use the invitation acceptance flow. Profile photo, date of birth, gender, tax ID, company registration number, organization website/logo, and billing details are not required for MVP onboarding.

### Why selected

- It collects only the fields needed for a usable retail tenant and accountable user.
- It preserves multi-organization and multi-branch access without account duplication.
- It avoids accidental tenant creation and cross-email identity linking for invitations.

### Consequences

- Schema and API work must distinguish platform profile, organization, branch, and membership data.
- New-organization onboarding must create the organization, first branch, and OWNER membership atomically and idempotently.
- Future collection of excluded fields needs a scoped product/data decision.

## ADR-016 — Use fixed organization RBAC with explicit branch assignments

- **Date:** 2026-08-22
- **Status:** Accepted
- **Type:** Authorization architecture

### Context

StockWise needs an MVP authorization model that prevents tenant and branch escalation while remaining understandable for small retailers. The prior accepted role names did not define their capability, delegation, or governance semantics.

### Alternatives considered

1. Custom roles and per-user permissions
2. Fixed RBAC with one organization role plus branch assignments
3. One branch role stored directly on each user

### Decision

Use fixed, deny-by-default RBAC: `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`. Each user has one role per organization and may have different roles in different organizations. `OWNER` and `ADMIN` have organization-wide branch access. `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER` require explicit assignments and may be assigned to multiple branches. Express enforces authorization; frontend checks are UX only.

The authoritative capability, role-governance, analytics, forecast, and AI-summary baseline is in `BUILD_SPEC.md` section 8. An OWNER manages owners and OWNER-only ownership actions; an ADMIN manages branches and non-owner memberships but cannot perform OWNER-only ownership changes. At least one OWNER must remain. Refund/void authority remains unresolved in `OQ-009`.

### Why selected

- Fixed roles and one organization role give a testable, reviewable MVP policy.
- Explicit branch assignments scope operational staff without duplicating accounts.
- Keeping refund/void outside the matrix preserves the unresolved sales-reversal decision boundary.

### Consequences

- The identity schema uses an organization-role membership plus role-less branch assignments; it must not model competing branch roles for a user.
- Policy tests must cover deny-by-default, tenant/branch isolation, delegation, last-owner protection, and immediate loss of access after deauthorization.
- Custom roles, direct user permissions, and any refund/void grants need a future accepted decision.

## 2. Explicitly superseded planning directions

The current ADRs supersede these earlier, unimplemented ideas:

| Earlier direction | Current accepted direction |
| --- | --- |
| FastAPI/Python backend | Express.js + TypeScript (`ADR-001`) |
| Python ML service now | TypeScript/SQL analytics and Forecasting V1 (`ADR-006`) |
| LLM/AI predicts product demand | Deterministic system forecast; OpenRouter summarizes only (`ADR-006`, `ADR-007`) |
| User-triggered AI generation | Scheduled daily/weekly/monthly/yearly persisted reports (`ADR-007`) |
| Google login in core MVP | Email/password + Argon2; Google future (`ADR-010`) |
| Multi-branch later | Organization -> Branch from the beginning (`ADR-003`) |
| Expense/accounting as part of scope | Retail sales/inventory/purchasing focus; expense/accounting non-goals (`BUILD_SPEC.md`) |

No implementation exists from the superseded directions in the current repository.
