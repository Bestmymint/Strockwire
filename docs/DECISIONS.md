# StockWise Architecture Decision Log

| Field | Value |
| --- | --- |
| Status | Accepted decision history |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-25 |

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

Use opaque server-side sessions backed by PostgreSQL for MVP. Generate a cryptographically random session token, send it only in the `stockwise_session` HttpOnly cookie, and persist only its cryptographic hash with the user, issue/last-use, idle/absolute expiry, and revocation state. The cookie has `Path=/`, is host-only (no `Domain` attribute), `SameSite=Lax`, and `Secure` in production but not on the accepted local HTTP path.

The idle-timeout baseline is a sliding 24 hours and the absolute-timeout baseline is a fixed seven days; both remain configuration values. A valid authenticated request persists an activity touch at most once every 15 minutes, setting `lastUsedAt` to the touch time and `idleExpiresAt` to the earlier of touch time plus 24 hours or absolute expiry. A required touch failure fails authentication closed. Absolute expiry never moves.

Successful authentication always creates a fresh token. When the incoming StockWise cookie resolves to a currently valid session for the same account, revocation as `login_rotation` and fresh-session creation occur atomically. Malformed, unknown, revoked, and expired incoming values are never reused and do not independently block valid credentials.

Do not use JWT for browser authentication, store tokens in `localStorage` or `sessionStorage`, or add a refresh-token flow. Rotate the session on successful authentication, revoke the current session on logout, support revoking every session for a user, and resolve authorization server-side on every protected request. Disabled or deauthorized users lose access when their request is evaluated.

### Why selected

- PostgreSQL is already the accepted durable system of record and makes revocation queryable for the MVP.
- Hash-only session-token storage limits the impact of a session-record disclosure.
- Opaque sessions make rotation, logout, all-session revocation, and membership/status revalidation direct.

### Consequences

- The identity schema must add an appropriately indexed, hash-only session record and expiry/revocation checks.
- Cookie-based state-changing endpoints need implementation-time cross-site-request protections; this ADR does not authorize an alternate credential transport.
- The API and web client must never return or persist a browser bearer token.
- Authentication context contains trusted actor/session identity only. Membership,
  role, organization, branch, and permission resolution remains a separate
  authorization/access-management boundary.

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

Task ownership is split deliberately: P2-M2-T01 creates only the unverified
account and no verification token or email delivery. P2-M2-T03 owns
verification-token creation, resend, provider integration/delivery, and
verification behavior.

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

Registration accepts only email and password, and the account must later verify
its email. The platform profile requires `displayName`; it is nullable on the
registration-stage user and supplied by the later profile/onboarding flow.
Profile phone is optional. New-organization onboarding requires organization
name and an initial branch name; branch phone and address are optional. The
creator becomes `OWNER` in the atomic onboarding result. No display-name
placeholder is derived from email.

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

## ADR-017 — Fix the registration/profile boundary and registration security baseline

- **Date:** 2026-08-24
- **Status:** Accepted
- **Type:** Product, security, data, and delivery boundary

### Context

P2-M1-T02 made `User.displayName` non-null even though ADR-015 assigns display
name to the later profile/onboarding flow and registration accepts only email
and password. P2-M2-T01 also required password, duplicate, verification-next-step,
and rate-limit behavior before those implementation-sensitive rules had a
single accepted baseline.

### Alternatives considered

1. Add display name to registration or derive a placeholder from email
2. Keep display name nullable until profile/onboarding
3. Create verification tokens and send email during P2-M2-T01 or assign the
   complete verification lifecycle to P2-M2-T03
4. Return an account-specific duplicate conflict or use one generic public
   response
5. Defer all abuse control to production or establish a bounded process-local
   MVP limiter while distributed controls remain open

### Decision

Registration accepts only email and password. `User.displayName` is nullable
until the later required profile/onboarding flow; registration never derives a
placeholder from email. Correct the committed schema through a new forward
migration that drops `users.display_name` `NOT NULL`; do not edit the initial
migration. A non-null display name must still contain non-whitespace content.

Registration passwords contain 15–128 Unicode code points. Preserve the value
exactly as supplied: do not trim, Unicode-normalize, silently truncate, or
require uppercase, lowercase, digits, or symbols. Whitespace and Unicode are
allowed. Breached-password screening is deferred.

P2-M2-T01 will use `argon2@0.45.1`, Argon2id,
`memoryCost=65536` KiB, `timeCost=3`, `parallelism=4`, and the library-generated
random salt, storing the PHC-format encoded hash. Compatibility and behavior
must be benchmarked and verified in P2-M2-T01; this correction does not install
Argon2 or implement hashing.

New and canonical-email duplicate registration attempts return the same generic
`202 Accepted` public response. PostgreSQL's unique canonical email remains the
final concurrency boundary, and raw Prisma uniqueness errors never escape.

P2-M2-T01 creates the account with `emailVerifiedAt = null` and creates no
verification-token record or email delivery. P2-M2-T03 owns verification-token
creation, resend, provider integration/delivery, and verification behavior.

Registration permits five attempts per 15 minutes per canonical email through
a deterministic process-local in-memory limiter. It stores no database state,
logs neither email nor password, and returns `429` with `Retry-After` when
exhausted. Distributed/IP-aware limiting and proxy/deployment topology remain
open under `OQ-020`; this decision does not close its unrelated production
readiness questions.

### Why selected

- It preserves the accepted minimal registration/profile boundary without
  fabricating user data.
- The password and Argon2id baselines are explicit and testable while keeping
  credential material unchanged before hashing.
- A uniform duplicate response reduces account-enumeration disclosure while
  retaining database-enforced race safety.
- Verification ownership prevents P2-M2-T01 from prematurely adding provider or
  token behavior.
- The process-local limiter provides deterministic MVP abuse control without
  claiming distributed production protection.

### Consequences

- The schema correction is a new forward migration; restoring `NOT NULL` later
  requires a reviewed backfill and another forward migration.
- P2-M2-T01 remains incomplete until its route, service, persistence, hashing,
  limiter, and security tests are implemented and verified.
- P2-M2-T03 owns verification and provider failure behavior even though the
  end-to-end registration use case continues through email verification.
- `OQ-020` remains open for distributed/IP-aware controls, proxy trust, and the
  rest of production readiness.

## ADR-018 — Bound verification and recovery abuse controls for MVP

- **Date:** 2026-08-24
- **Status:** Accepted
- **Type:** Security and delivery boundary

### Context

P2-M2-T03 requires account-safe verification resend and password recovery, but
`OQ-020` intentionally leaves production-wide abuse architecture open. The task
still needs deterministic application-level behavior that cannot become an
account-existence oracle.

### Decision

Verification resend and password-reset request each use an independent
process-local fixed-window limiter. Three syntactically valid requests are
accepted per canonical email per 15 minutes; a SHA-256 derivative is the only
stored key. Every valid request consumes before account lookup and provider work
regardless of account existence, verification/status eligibility, or delivery
outcome. Attempt four and later returns `429 RATE_LIMITED` with deterministic
remaining-window `Retry-After`; success does not reset the window. Malformed
email follows validation and creates no limiter entry.

Reset completion adds no token-keyed process-local limiter. Opaque 32-byte,
hash-only, single-use, 30-minute tokens are validated for active state before
Argon2, so malformed, random, expired, revoked, replaced, consumed, and replayed
tokens do not trigger password hashing or allocate attacker-controlled keys.

These are narrow MVP exceptions. `OQ-020` remains open for distributed,
IP-aware, global/provider-wide, reverse-proxy-trust, multi-instance,
production-DoS, long-term abuse-telemetry, and other production-readiness
controls.

### Consequences

- Existing/missing/ineligible accounts have the same pre-exhaustion status/body,
  limiter count, and `Retry-After` behavior.
- The two request flows do not share counters, and no reset-completion limiter
  state exists.
- Process restart or another instance has an independent counter; this is not
  represented as production-grade distributed protection.

## ADR-019 — Persist one replay-safe first-organization onboarding result

- **Date:** 2026-08-24
- **Status:** Accepted
- **Type:** Product, data, API, and concurrency boundary

### Context

The accepted minimal onboarding fields did not define the required physical
branch code, one-time eligibility, durable replay identity, or post-success
destination. The existing multi-organization membership model intentionally
cannot use membership uniqueness alone to identify the one first-onboarding
result.

### Decision

`POST /organizations` is the authenticated verified user's one-time first-
organization command. With no persisted onboarding provenance, eligibility
requires zero `OrganizationMembership` rows of any status; a pending invitation
alone does not block it. Submitted profile values replace existing profile
values only during the successful initial transaction.

Create the initial branch with server-owned code `MAIN`; the client neither
supplies nor derives it. Required text is boundary-trimmed and nonblank. Optional
phone/address text is boundary-trimmed and blank becomes `NULL`. Preserve
internal whitespace and Unicode representation without case folding, Unicode
normalization, or phone transformation.

Persist one `FirstOrganizationOnboarding` row per user containing the created
organization, same-organization branch, canonical-request SHA-256 hash, and
completion time. Restrictive foreign keys and the composite branch/organization
relationship preserve tenant integrity. The API locks the user row and rechecks
provenance/membership inside the transaction; the per-user primary key remains
the authoritative uniqueness boundary. The transaction updates profile and
creates organization, OWNER membership, `MAIN` branch, and provenance together.

Existing provenance plus the same hash returns HTTP `200` with the original
logical resource result and no mutation. A different hash returns `409
ALREADY_ONBOARDED`; membership without provenance returns `409
ALREADY_HAS_ORGANIZATION_ACCESS`. No client idempotency key or serialized HTTP
response is stored. Success returns only safe user/organization/branch data,
role `OWNER`, and `nextStep = app`; the web client navigates to a minimal `/app`
holding route.

### Consequences

- This endpoint cannot create a second organization; that requires a later
  explicit capability and contract.
- OWNER is organization-wide and the initial transaction creates no branch
  assignment.
- Invitation acceptance and later branch code rules remain separate tasks.
- Request hashes, provenance identifiers, session state, and permission arrays
  never enter the public response.

## ADR-020 — Use lifecycle branches and URL-only application context

- **Date:** 2026-08-24
- **Status:** Accepted
- **Type:** Product, data, API, authorization, and frontend-state boundary

### Context

P2-M3-T02 required exact post-onboarding code rules, branch lifecycle and
concurrency behavior, effective-access representation, and a switcher state
owner. Persisting a selected branch in several places would create stale or
conflicting authority, while deactivation without serialization could leave an
organization with no active branch.

### Decision

An `OWNER` or `ADMIN`, authorized by centralized `branch.manage`, creates and
manages branches. Submitted codes are trimmed, uppercased, 1–16 characters,
match `[A-Z0-9][A-Z0-9_-]*`, are immutable, and are unique per organization;
`MAIN` has no global reservation. Names are trimmed/nonblank up to the existing
schema limit, duplicates are allowed, and optional phone/address values are
trimmed with blank mapped to `NULL`.

Branches have explicit activate/deactivate commands and no delete endpoint.
Every edit or lifecycle command includes the exact prior millisecond UTC
`updatedAt`. Mismatch returns `409 BRANCH_STALE`; matching same-state lifecycle
is idempotent. Deactivation locks the organization row and checks at least one
other active branch inside the transaction, returning `409 LAST_ACTIVE_BRANCH`
when prohibited. Assignments remain persisted, have no effect while their
branch is inactive, and regain effect on reactivation when otherwise active.

Default branch listing returns active rows. Only `OWNER`/`ADMIN` may include
inactive rows; branch-only roles receive active assigned rows. Results are
unpaginated and code-ascending for MVP. `GET /me/access-context` returns only
active memberships/organizations and effective active branches: all active
branches for `OWNER`/`ADMIN`, active assigned branches for other roles.

The browser owns selection only in
`/app?organizationId=<id>&branchId=<id>`. It re-resolves candidates against
fresh access context, applies deterministic fallbacks, and canonicalizes with
`router.replace`. No database, user/session record, cookie, `localStorage`, or
`sessionStorage` selection is added. Before transition or revoked-context
fallback, it cancels and removes the previous TanStack Query prefix
`["branch-scoped", organizationId, branchId, ...]`.

### Consequences

- URL values select navigation candidates but never prove access; every API
  endpoint continues server-side membership, scope, status, and permission
  validation.
- A refresh or access revocation can immediately remove an ineffective branch
  from navigation and its old cached branch data.
- Branch deletion, branch-code changes, selection persistence, membership
  administration, and later retail features are outside P2-M3-T02.

## ADR-021 — Serialize email invitations and full-replacement membership access

- **Date:** 2026-08-24
- **Status:** Accepted
- **Type:** Product, data, API, authorization, concurrency, and security boundary

### Context

P2-M3-T03 needed exact invitation replacement/revocation/acceptance semantics,
delegation limits, member lifecycle rules, and concurrency-safe ownership. The
base schema could bind invitation email and branch scope, but could not prove
issuer/revoker/source provenance or retain the resulting access scope. Simple
application pre-checks could also race and leave zero active owners or create
conflicting invitation outcomes.

### Decision

`OWNER` manages every role. `ADMIN` may view owner rows but may invite or mutate
only non-owner access and may never grant `OWNER`. Branch roles have no
management authority. Invitations are allowed only when no active or inactive
membership exists for the canonical email in the organization. Organization-
wide roles require an empty branch scope; branch-only roles require at least one
unique active same-organization branch.

Every create/reissue stores a fresh hash-only seven-day token in a new row and
marks the prior open invitation `REPLACED`. Explicit revoke is idempotent for
revoked/expired state, records `CANCELLED`, and cannot override acceptance.
Provider failure conditionally records `DELIVERY_FAILED`. Acceptance requires an
authenticated verified actor whose canonical email matches, revalidates branch
scope, and atomically creates membership, assignments, source provenance, an
`INVITATION_ACCEPTED` event/scope snapshot, and consumption. Same accepted-user
replay returns the linked current membership without mutation; all other bad
token states use the generic invalid-invitation family.

Member PATCH and reactivation are full desired-state replacements with exact
`updatedAt`. Organization-wide results inactivate assignments; branch-role
results activate exactly the submitted active scope. Deactivation retains role,
assignment rows, and sessions but immediately removes effective access.
Reactivation never implicitly restores prior access. Membership mutations and
invitation lifecycle transitions lock the organization first; invitation
operations then lock the invitation. Active-owner count is re-read inside that
transaction so concurrent reductions cannot leave zero active owners.

The schema retains the composite membership primary key and adds a stable
resource ID, same-tenant invitation issuer/revoker and membership-source keys,
and narrowly named immutable membership-access event/scope tables. These tables
cover only T03 access provenance; `OQ-019` remains open for a future generic
audit design. Management lists use opaque `(createdAt,id)` cursors with default
25 and maximum 100. Invitation tokens remain transient in the acceptance URL
and never enter browser storage, logs, list payloads, or UI text.

### Consequences

- Existing users and new users follow the same authenticated, verified-email
  acceptance contract; the system never creates or links accounts automatically.
- Session revocation is not a membership lifecycle side effect. Every protected
  request must re-resolve active membership and branch scope.
- Cross-tenant provenance and scope are rejected by composite foreign keys as
  well as server-side authorization.
- Ownership transfer, generic audit, invitation-specific rate limiting, and
  distributed/provider abuse controls remain outside T03.

## ADR-022 — Fix organization catalog price, unit, and lifecycle boundaries

- **Date:** 2026-08-25
- **Status:** Accepted
- **Type:** Catalog/data-model architecture

### Context

The catalog schema needs a stable organization-level price, base-unit, normalization, and lifecycle boundary before it can safely persist Products and Categories. Branch-specific pricing, quantity conversion, and product cost would otherwise cause speculative schema/API work and blur later sales, inventory, and purchasing decisions.

### Alternatives considered

1. Branch-specific current prices and effective-dated overrides in MVP
2. Multiple purchasing/selling units with automatic conversions
3. A single organization base price and one immutable base unit per Product, with later cost and transaction rules deferred

### Decision

Use option 3. Branch-level price overrides are out of MVP scope. A Product has one required organization-level non-negative `basePrice`, represented in APIs as a decimal string at scale at most four and targeted to `DECIMAL(19,4)` persistence. Excess scale is invalid rather than rounded. This configured catalog price affects future operations only; future sale items snapshot the unit price actually used. `OQ-008` remains open for tax, discount, currency, receipt/payment behavior, and transaction rounding.

Each Product stores exactly one immutable base unit from `EA`, `PACK`, `BOX`, `KG`, `G`, `L`, `ML`, `M`, or `CM`. `EA`, `PACK`, and `BOX` are integer-only. The others permit up to four fractional digits. Quantity APIs are decimal strings, target `DECIMAL(18,4)`, reject excess precision rather than rounding, and require positive values when an operation requests a positive amount. MVP has no unit, pack-size, or purchasing/selling-UOM conversion. Signed inventory-ledger semantics remain for inventory work; derived analytics rounding remains `OQ-011`.

Product names are trimmed, nonblank, Unicode-preserving, and non-unique. SKU is canonical trim/NFKC/uppercase, must match `^[A-Z0-9][A-Z0-9._-]{0,63}$`, and is unique within an organization. Barcode is optional, trimmed, blank-to-null, control-character-free, at most 128 characters, and exact-match unique within an organization when present. Categories are flat with a nullable product relation. Their display names are trimmed/nonblank while an NFKC/trim/collapsed-Unicode-whitespace/lowercase key is unique within an organization.

Products and Categories use `ACTIVE`/`INACTIVE`, may reactivate, and have no hard-delete endpoint. An inactive category retains references but cannot receive a new product assignment; it does not deactivate or silently reassign products. Product reassignment to another active category or null is explicit. Category merge/bulk reassignment is excluded. Category and Product mutations use exact `updatedAt` optimistic concurrency and return `CATEGORY_STALE` or `PRODUCT_STALE` on stale state.

Product has no authoritative cost, average-cost, COGS, or inventory-valuation field. `OQ-010` remains open and governs later receiving valuation, inventory valuation, COGS, and authoritative purchasing-cost behavior.

### Worked boundary examples

| Input or state | Result |
| --- | --- |
| Base price `"60"`, `"60.5"`, or `"60.1234"` | Accepted as an organization-level configured amount for every branch. |
| Base price `"60.12345"` or `"-1"` | Rejected; catalog input never rounds and base price is non-negative. |
| `EA` quantity `"3"` or `"3.0"` | Accepted; canonical integral output is `"3"`. |
| `EA` quantity `"3.5"` or `BOX` quantity `"1.25"` | Rejected because the unit is integer-only. |
| `KG` quantity `"0.125"` or `"0.1234"` | Accepted. `KG` quantity `"0.12345"` is rejected rather than rounded. |
| SKU `" abc-01 "` and `"Abc-01"` in one organization | Both canonicalize to `ABC-01`; the second write conflicts. |
| Barcode `" ABC-01 "` and `"ABC-01"` in one organization | Both store as the same exact trimmed value; the second write conflicts. |
| Categories `"Food"`, `" food "`, and `"FOOD"` in one organization | All have the same normalized identity; only one may exist. |
| An inactive Category referenced by active Products | References remain and products remain active, but the category cannot be assigned to another product until reactivated. |
| Product deactivation or base-price edit | Existing historical records remain unchanged; a later sale snapshots the unit price actually used. |
| Cost, average cost, COGS, or inventory valuation on Product | Not modeled in P3-M1-T02; authority remains blocked by `OQ-010`. |

### Why selected

- One base price and one base unit fit the MVP without introducing conversion, time-effective pricing, or costing machinery.
- Database-enforced organization uniqueness and explicit lifecycle rules protect catalog identity and historical references.
- Deferring transaction pricing and costing keeps unresolved sales/purchasing behavior from becoming accidental catalog truth.

### Consequences

- P3-M1-T02 may model Category and Product with accepted base price, unit, normalization, lifecycle, and tenant constraints, but without cost/valuation or branch-price fields.
- Future inventory, purchasing, sales, and analytics implementations must consume the accepted unit precision while retaining their own unresolved stock, cost, transaction-rounding, and metric rules.
- A post-MVP branch-price feature requires a new accepted decision, schema/API/UI scope, and sale-price snapshot compatibility review.

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
