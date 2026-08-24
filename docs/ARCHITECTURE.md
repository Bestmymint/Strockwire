# StockWise Architecture

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1; accepted logical architecture; minimal web/API shells implemented |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-25 |

## 1. Scope and authority

This document is the Source of Truth for system boundaries, component responsibilities, data flows, module dependency rules, tenancy, and conceptual deployment. Product requirements are owned by `BUILD_SPEC.md`; physical tables by `docs/DATABASE.md`; formulas by `docs/ANALYTICS.md`; and HTTP contracts by `docs/API.md`.

The repository layout is accepted by `ADR-011`. The exact production hosting topology (`OQ-015`) remains unresolved. Diagrams below are logical, not a claim that infrastructure exists.

## 2. Architecture summary

StockWise is a TypeScript modular monolith with two primary runtime applications:

- A responsive Next.js web application
- An Express REST API containing explicit business-domain modules

PostgreSQL is the system of record. Prisma owns application data access and migrations. Deterministic analytics and forecasts run in TypeScript/SQL. Scheduled jobs build aggregate snapshots and call OpenRouter only for natural-language summaries.

```mermaid
flowchart TD
    U[Users on desktop, tablet, or phone] --> W[Next.js responsive web]
    W -->|REST /api/v1| API[Express TypeScript modular monolith]

    subgraph API_MODULES[Application modules]
        IAM[Identity and access]
        TEN[Organizations and branches]
        CAT[Catalog]
        INV[Inventory]
        PUR[Suppliers and purchasing]
        SAL[POS and sales]
        AN[Analytics and forecasting]
        INS[Scheduled AI insights]
    end

    API --> IAM
    API --> TEN
    API --> CAT
    API --> INV
    API --> PUR
    API --> SAL
    API --> AN
    API --> INS
    API_MODULES --> DB[(PostgreSQL)]
    API --> S3[S3 object storage when required]
    EVT[EventBridge schedule in production] --> JOB[Scheduled application job]
    JOB --> AN
    JOB --> OR[OpenRouter API]
    JOB --> DB
    CW[CloudWatch] -. logs metrics alerts .- W
    CW -. logs metrics alerts .- API
    CW -. job telemetry .- JOB
```

The Next.js/Express shells, operational probes, local PostgreSQL/Prisma identity foundation, pure authorization policy, complete authentication lifecycle/UI, authenticated replay-safe first-organization/`MAIN`-branch onboarding, branch management/URL-owned context switcher, and invitation/membership access management are implemented. No retail domain, analytics/AI integration, AWS resource, or production deployment exists yet.

### Repository boundaries

The native pnpm workspace uses these physical boundaries:

```text
stockwise/
  apps/
    web/                 # Next.js App Router shell under src/app
    api/                 # Express transport shell and future modular monolith
      src/modules/       # Business modules remain inside the API application
      prisma/            # API-owned Prisma schema and migrations
  packages/              # Deliberately shared internal packages only when justified
  docs/                  # Architecture and technical Source of Truth documents
  tests/e2e/             # Future cross-application end-to-end tests
  infra/                 # Future deployment/infrastructure configuration
```

Only `apps/*` and `packages/*` are package-manager workspaces. Tests should normally be colocated with their owning application or module; `tests/e2e` is reserved for cross-application workflows. `packages` must not become a catch-all shared layer, and no package is created there without a concrete consumer and dependency rationale. The scheduled job remains an API application entry point unless a later accepted ADR demonstrates a separate deployment need.

## 3. Architecture style: modular monolith

The backend is one deployable application divided by business capability. Modules have owned responsibilities and expose deliberate application interfaces. They do not become separately deployed services.

### Why this style

- The project and team are small enough that service orchestration would add cost without proven benefit.
- Checkout and receiving need strong transactions across sales/purchasing and inventory.
- Domain boundaries are still evolving.
- One TypeScript backend keeps deployment, security, logging, and local development manageable.
- A well-factored modular monolith preserves future extraction options if a measured scaling or ownership need emerges.

### Rules

- HTTP routing is an adapter, not the home of business rules.
- Module-owned application services coordinate use cases.
- Persistence queries must include trusted tenant/branch scope.
- Cross-module writes are coordinated by explicit use cases and one database transaction where atomicity is required.
- Domain modules may depend on small stable contracts; they must not import another module's internal repositories or controllers.
- No module may call another StockWise module over HTTP inside the same application.
- Adding a separately deployable service, queue, or second language requires an accepted ADR.

## 4. Logical component responsibilities

| Component | Responsibilities | Must not do |
| --- | --- | --- |
| Next.js web | Responsive UI, navigation, accessibility, local interaction state, TanStack Query server state, render charts, send validated user intent | Establish trusted tenant scope, calculate authoritative price/totals, mutate stock directly, call OpenRouter |
| Express API edge | Route `/api/v1`, authenticate, validate with Zod, authorize, invoke use cases, map errors, emit request telemetry | Contain domain calculations in controllers, trust client totals/scope |
| Identity and access | Email/password identity, Argon2 verification, opaque PostgreSQL-backed sessions, provider-abstracted verification/reset/invitation email, organization membership, branch assignment, fixed RBAC policy | Infer access from client-provided IDs or couple auth-domain behavior directly to Resend |
| Organizations and branches | Tenant lifecycle, branch lifecycle, active/allowed scope resolution | Own product, sale, or inventory business rules |
| Catalog | Organization products/categories, SKU/barcode rules, accepted master-data lifecycle, one immutable base unit, and organization-level base price data | Hold branch inventory as `product.stock`, cost/valuation authority, branch-price overrides, or rewrite sale history |
| Inventory | Branch balances, append-oriented ledger, adjustments, stock availability, movement history | Change balances without ledger records; decide `OQ-007` itself |
| Suppliers and purchasing | Organization suppliers, branch-targeted purchase orders, receipt lifecycle | Update inventory outside an atomic receiving use case |
| POS and sales | Server-side cart validation, checkout, immutable line snapshots, payment records, history, receipt views, reversal after rules are accepted | Trust prices/totals from browser; commit a partial checkout |
| Analytics and forecasting | Accepted metric formulas, period boundaries, branch/organization aggregation, deterministic forecast and evaluation | Ask an LLM to calculate or forecast; invent unresolved formulas |
| Scheduled AI insights | Snapshot creation, minimization, prompt version, provider call, idempotency, persistence, retry/failure status | Query raw database through OpenRouter; block core workflows |
| PostgreSQL | System of record, constraints, transactions, indexes, balances, ledgers, snapshots, persisted insights | Serve as an authorization substitute without scoped queries |
| S3 | Object assets only when required, such as product images or generated report assets | Store transactional truth that belongs in PostgreSQL |
| EventBridge | Production cadence trigger for scheduled report work | Define business-period semantics |
| CloudWatch | Operational logs, metrics, dashboards, and alerts | Receive secrets, raw passwords, or unnecessary personal data |
| SQS (conditional) | Buffer background work only after measured need and accepted ADR | Be a default dependency or source of transactional truth |

## 5. Tenant and branch boundaries

```mermaid
flowchart TD
    P[Platform] --> O[Organization tenant]
    O --> B1[Branch A]
    O --> B2[Branch B]
    O --> C[Organization product catalog]
    O --> S[Organization suppliers]
    O --> M[Organization memberships]
    B1 --> I1[Inventory balances and ledger]
    B1 --> PO1[Purchase orders and receipts]
    B1 --> SA1[POS and sales]
    B2 --> I2[Inventory balances and ledger]
    B2 --> PO2[Purchase orders and receipts]
    B2 --> SA2[POS and sales]
```

### Accepted invariants

1. `Organization` is the tenant boundary.
2. `Branch` belongs to one organization.
3. Product/category/supplier belongs to one organization.
4. Inventory balance/transaction, purchase order/receipt, and sale/payment belongs to one branch.
5. A branch-owned record's organization must equal the organization of every organization-owned resource it references.
6. A user can have organization-wide access and/or access to multiple branches.
7. An organization aggregate is computed only from branches visible to the actor.
8. Background jobs execute with an explicit organization and report scope, not an unrestricted global query accidentally reused from request code.
9. Catalog persistence carries `organization_id` on Category and Product; a Product's nullable Category relation uses a composite Category/organization foreign key, so PostgreSQL rejects cross-tenant references independently of application code.

### Trusted request context

Conceptually, the API establishes:

```text
Authenticated actor
  + verified organization membership
  + verified branch assignment when branch-scoped
  + role permission for action/resource
  = authorized request context
```

Path/query/body fields select a candidate resource; they never grant access. Cross-tenant records should be reported without revealing their existence.

P3-M1-T03 applies that boundary to the organization-owned catalog. Catalog
routes accept optional query `branchId`: `OWNER`/`ADMIN` may use organization
scope without it, while branch-scoped roles must provide an active branch that
the API re-resolves with an effective active assignment. Supplied branch IDs
are candidates only; missing required context is distinct from the common safe
forbidden result used for nonexistent, inactive, cross-tenant, unassigned, or
revoked context. Catalog controllers never accept role, membership, assignment,
permission, actor, or tenant ownership as client authority.

### Application context and branch cache boundary

`GET /api/v1/me/access-context` returns only active memberships and currently
effective active branches. `OWNER`/`ADMIN` receive every active branch in the
organization; branch-only roles receive only active explicitly assigned
branches. The response is safe display/navigation data, not a permission token.

The Next.js application uses only `/app?organizationId=<id>&branchId=<id>` for
selection. Each load resolves those candidates against the newest access
context, chooses the first code-ascending effective branch when a candidate is
missing or revoked, and replaces the URL with the canonical result. A switch or
revocation cancels and removes the old TanStack Query prefix
`["branch-scoped", organizationId, branchId, ...]` before transition so cached
data from the prior branch cannot render as current.

### Authorization policy convention

P2-M1-T03 establishes the API-owned, pure policy foundation at
`apps/api/src/modules/identity/authorization-policy.ts`. It owns the fixed
typed permission vocabulary, server-resolved authorization context, trusted
organization/branch resource scopes, and the centralized `can(context,
permission, resourceScope)` decision. It issues no database query and is not
itself a database service. Protected branch and membership use cases resolve
trusted state from PostgreSQL and call this policy before mutation or exposure.

- A trusted context is constructed only from server-resolved actor,
  membership, and branch-assignment state. It retains the actor and membership
  identities, active/disabled states, organization role, and active assigned
  branch IDs; actor/membership or assignment organization mismatches fail
  closed.
- A trusted branch scope carries both the requested organization and the
  branch's resolved owning organization. A mismatch fails before a role can
  receive organization-wide or branch-assignment access.
- `OWNER` and `ADMIN` may use organization scope and every branch in their
  organization. `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER` must use an
  actively assigned branch scope; organization scope and zero or inactive
  assignments deny access.
- The vocabulary includes the accepted catalog, supplier, inventory,
  purchasing/receiving, checkout, sales-history, analytics, forecast/reorder,
  AI-summary, and governance capabilities. It excludes refund/void authority
  until `OQ-009` is resolved. `ADMIN` can manage only non-owner memberships;
  OWNER membership, ownership transfer, and destructive ownership actions are
  OWNER-only. Membership mutations serialize on the organization row and
  preserve the last-active-OWNER invariant.

## 6. Critical data flows

### 6.1 Authentication and scope selection

Registration and verification are separate task boundaries. P2-M2-T01 accepts
only email and password, normalizes the email, applies the accepted per-email
process-local limiter, stores a PHC-encoded Argon2id verifier, and creates an
unverified platform user with no profile, organization, branch, session, or
verification-token record. New and canonical-email duplicate attempts return
the same generic `202 Accepted` public response. P2-M2-T03 later owns
verification-token creation, resend, email-provider integration/delivery, and
verification behavior.

P2-M2-T03 implements verification issuance through the account-safe resend
endpoint and password recovery through the same identity module. Use cases
depend only on an `IdentityEmailProvider`; runtime selection binds production
to Resend and development/test to non-delivery/recording adapters. A provider
call occurs only after the token transaction commits. Provider failure is
non-disclosing and triggers a conditional revocation of the just-issued token;
there is no outbox or generic messaging framework in this MVP boundary.

Verification and reset replacement transactions lock the owning user row,
replace every prior open token, and create one fresh hash-only token. This
serializes concurrent application requests without changing the accepted
schema. Verification consumption and email state update are atomic. Reset first
performs a cheap active-token lookup, then Argon2, then conditionally consumes
the token, updates the password, and revokes all sessions in one transaction.

The implemented registration boundary is split into the Express/Zod transport,
an application service, the centralized Argon2 password boundary, a deterministic
process-local limiter, and Prisma persistence/error translation. The limiter
stores only SHA-256-derived in-memory keys for canonical emails and runs before
Argon2. Persistence performs no existence pre-read: valid permitted requests
follow the same hash-and-create flow, PostgreSQL remains authoritative under
races, and only the canonical-email uniqueness conflict is translated to the
generic success outcome. No synthetic delay, login/session behavior, token
generation, email provider, or onboarding behavior is part of this boundary.

1. The client sends credentials over TLS.
2. The API validates the request and verifies the Argon2 password hash.
3. The API creates a fresh 256-bit opaque session token, sends it only in the `stockwise_session` HttpOnly cookie, and stores only its SHA-256 hash in PostgreSQL. A currently valid same-user cookie session is revoked as `login_rotation` in the fresh-session transaction.
4. Login returns only safe actor `id`, canonical `email`, and nullable `displayName`; it does not load or return membership, role, organization, branch, permission, or authorization state.
5. For each protected request, authentication resolves the active, verified actor and session from the token hash. Sliding idle activity is persisted at most once per 15 minutes and never extends fixed absolute expiry.
6. Access-management/policy wiring separately resolves current membership and branch assignment. If a branch is selected, it verifies organization ownership and actor permission before returning accessible scope.

P2-M3-T01 adds one authenticated first-organization command at
`POST /api/v1/organizations`. The Express boundary accepts only the six profile,
organization, and initial-branch fields, applies accepted canonical trimming,
and hashes their deterministic canonical representation internally. The use case
locks the platform user row, re-evaluates unique onboarding provenance and every
membership status inside one PostgreSQL transaction, and either replays, rejects,
or atomically updates the profile and creates the organization, `OWNER`
membership, `MAIN` branch, and provenance row. The provenance branch uses the
existing composite branch/organization identity; the client supplies no actor,
tenant, role, branch code, or authorization state. OWNER remains organization-
wide and receives no assignment. The web form uses the same-origin Express path
and navigates success only to the minimal `/app` holding shell.

P2-M3-T03 keeps membership governance in the identity module and wires the
central policy into authenticated Express routes. Invitation creation locks the
organization, validates delegation and the complete active same-tenant branch
scope, replaces any prior open invitation, stores only a fresh token hash, and
delivers the transient `/accept-invitation` URL through the existing provider.
Provider failure conditionally revokes only that new invitation.

Acceptance resolves a hash candidate, then locks the organization and
invitation in that order. It revalidates lifecycle, canonical actor email, and
branch state before atomically creating membership/assignments, consuming the
invitation, linking `sourceInvitationId`, and recording the bounded access
event/scope snapshot. Concurrent same-token acceptance reconciles to one
logical result; revoke and reissue use the same lock order. Role/scope edits,
deactivation, and reactivation are exact-version full replacements under the
organization lock. Deactivation leaves sessions and configured assignments
intact but authorization/access-context re-evaluation immediately removes the
membership. `/app/members` is management UX only; the API remains authoritative.
Invitation tokens remain URL-transient and are never copied to browser storage.

The browser never receives a JWT or refresh token and never stores an auth token in `localStorage` or `sessionStorage`. Session expiry/revocation and disabled actors are evaluated server-side; deauthorized membership is denied later by the separate authorization boundary. The cookie has `Path=/`, is host-only, `SameSite=Lax`, and `Secure` in production but not local HTTP. Configurable timeout baselines are sliding 24 hours idle, fixed seven days absolute, and a 15-minute minimum persisted-touch interval.

### 6.2 Purchase receiving

```mermaid
sequenceDiagram
    actor Staff
    participant API as Express API
    participant PUR as Purchasing module
    participant INV as Inventory module
    participant DB as PostgreSQL

    Staff->>API: Receive PO quantities for branch
    API->>API: Authenticate, validate, authorize branch
    API->>PUR: Load PO and verify receivable state
    PUR->>DB: Begin transaction
    PUR->>DB: Create receipt and receipt-line snapshots
    PUR->>INV: Record PURCHASE_RECEIVE movements
    INV->>DB: Append ledger entries and update locked balances
    PUR->>DB: Update PO/receipt state and accepted costing data
    DB-->>PUR: Commit all changes
    PUR-->>API: Completed receipt representation
```

Any validation, authorization, state, cost, quantity, or database error rolls back the complete operation. Partial/over-receiving and cost behavior are blocked by `OQ-021` and `OQ-010`.

### 6.3 POS checkout

```mermaid
sequenceDiagram
    actor Cashier
    participant Web
    participant API as Express API
    participant Sales
    participant Inventory
    participant DB as PostgreSQL

    Cashier->>Web: Submit cart and payment intent
    Web->>API: POST checkout with idempotency key
    API->>API: Authenticate, validate, authorize branch
    API->>Sales: Re-load products and compute trusted totals
    Sales->>DB: Begin transaction
    Sales->>DB: Lock/read required inventory balances
    Sales->>Sales: Enforce accepted stock and payment rules
    Sales->>DB: Create sale, line snapshots, payment
    Sales->>Inventory: Record SALE movements
    Inventory->>DB: Append ledger entries and update balances
    DB-->>Sales: Commit all changes
    Sales-->>API: Stable sale/receipt response
    API-->>Web: Return same result on safe retry
```

The operation must never leave a completed sale without its matching inventory and payment records. Negative-stock and payment semantics remain blocked by `OQ-007` and `OQ-008`.

### 6.4 Deterministic analytics

1. The actor requests a period, branch, or allowed organization aggregate.
2. The API resolves authorization and canonical period boundaries.
3. Analytics reads only accepted completed-sale/inventory states once `OQ-011` is closed.
4. SQL performs set aggregation; TypeScript applies accepted formulas where appropriate.
5. The response includes period, scope, metric version, data completeness, and values.
6. Reusable scheduled snapshots may be stored to avoid repeated expensive computation.

`docs/ANALYTICS.md` exclusively owns formulas and period semantics.

### 6.5 Scheduled AI insight

```mermaid
sequenceDiagram
    participant E as EventBridge
    participant J as Scheduled job
    participant A as Analytics module
    participant DB as PostgreSQL
    participant O as OpenRouter

    E->>J: Trigger cadence
    J->>DB: Claim unique report scope and period
    J->>A: Build accepted aggregate snapshot
    A-->>J: Versioned, minimized numerical facts
    J->>J: Remove prohibited fields and validate schema
    J->>O: Prompt + snapshot
    alt provider success
        O-->>J: Natural-language summary
        J->>DB: Persist insight, provenance, and success status
    else timeout/error/invalid output
        J->>DB: Persist safe failure status and retry metadata
    end
```

Dashboard reads the persisted result. Opening or refreshing the dashboard does not call OpenRouter. Scheduled job mechanics, model/fallback, and schedule times are governed by `OQ-017` and `OQ-018`.

## 7. Data ownership and module interactions

| Owning module | Owns | Authorized collaborating use cases |
| --- | --- | --- |
| Identity/access | Users, memberships, branch assignments, role policy | All modules ask it to establish/check actor scope |
| Organizations/branches | Organization and branch lifecycle | Catalog/inventory/purchasing/sales validate ownership |
| Catalog | Categories and products | Inventory references product; purchasing/sales snapshot product data |
| Inventory | Balance and transaction ledger | Receiving adds; checkout subtracts; approved reversal compensates |
| Purchasing | Supplier, purchase order, receipt | Receiving coordinates inventory and accepted costing |
| Sales | Sale, line snapshots, payment, receipt/reversal lifecycle | Checkout/reversal coordinates inventory |
| Analytics | Metric queries/snapshots/forecast/evaluation | Reads stable operational data; supplies aggregate AI snapshot |
| AI insights | Insight job/run/output/provenance | Reads validated analytics snapshot only |

Owning a table does not mean bypassing another module's invariant. For example, Sales does not directly decrement an arbitrary balance; the checkout use case invokes the inventory contract inside the same transaction.

## 8. Frontend architecture responsibilities

- Use Next.js and TypeScript for the responsive web client.
- Use TanStack Query for remote server state and cache invalidation.
- Use Tailwind CSS and shadcn/ui for the component system.
- Use Recharts for accessible, labeled chart views; provide textual/tabular alternatives for critical numbers.
- Keep authorization enforced on the API even if the UI hides inaccessible actions.
- Treat selected organization/branch as navigation context, not proof of permission.
- Present loading, empty, stale, partial-data, error, and retry states.
- Never compute authoritative checkout prices or analytics in the browser.
- Do not add a native wrapper or offline mutation queue within the current scope.
- Use the Next.js App Router with the `src/app` directory convention; do not use the Pages Router.
- Keep React Server Components as the default and add `"use client"` only at boundaries that require state, effects, event handlers, browser APIs, or client-only providers.
- Add Route Groups such as `(auth)` or `(app)` only when implemented routes justify them; do not create speculative route structure.
- Keep StockWise core and business REST APIs in the Express application. Do not implement them as Next.js Route Handlers.
- During local development, the browser reaches the Express operational health
  probe through the Next.js same-origin `/api/health` rewrite and Express-owned
  REST endpoints through the same-origin `/api/v1/:path*` rewrite. Both target
  the API's loopback origin and avoid enabling broad browser-to-API CORS. The
  server-only loopback origin never enters a client bundle.

## 9. Backend layering

Within `apps/api`, each module must preserve these responsibilities:

```text
HTTP route/controller
        |
validation + authenticated context
        |
application use case
        |
domain rules / module contracts
        |
Prisma-backed persistence and external adapters
```

- Controllers map HTTP to application input/output.
- Zod schemas validate external shape and basic constraints.
- Application use cases coordinate authorization, transactions, and modules.
- Domain rules express invariant decisions independent of Express.
- Persistence adapters issue scoped queries and translate database errors.
- External adapters isolate OpenRouter, S3, scheduler, logging, and time.

Avoid a generic repository abstraction that erases query semantics, tenant scope, locking, or transaction requirements.

## 10. Data consistency strategy

### Strong consistency required

- Checkout and inventory deduction
- Receiving and inventory addition
- Adjustments and balance changes
- Refund/void reversal once defined
- Uniqueness and membership constraints
- Idempotent creation of a sale, receipt, snapshot, and scheduled report

### Derived/read models

- `InventoryBalance` is a transactionally maintained projection of ledger movements.
- Analytics snapshots and AI insights are derived and reproducible from operational truth, subject to versioning and retention rules.
- A stale AI insight is acceptable and must be labeled; a stale or inconsistent stock balance is not.

No event-driven eventual consistency is required for the core MVP flows.

## 11. AWS deployment boundaries

Accepted AWS services define capabilities, not the final topology:

```mermaid
flowchart TD
    INTERNET[Internet users] --> EDGE[Production ingress and frontend hosting - OQ-015]
    EDGE --> WEB[Next.js deployment - OQ-015]
    WEB --> API[Dockerized Express deployment - OQ-015]

    subgraph VPC[AWS VPC]
        API --> RDS[(RDS PostgreSQL)]
        API --> S3[S3 through approved access path]
    end

    EB[EventBridge] --> JOB[Scheduled application job - hosting governed by OQ-015]
    JOB --> RDS
    JOB --> OR[OpenRouter over TLS]
    WEB -. telemetry .-> CW[CloudWatch]
    API -. telemetry .-> CW
    JOB -. telemetry .-> CW
```

The final design must decide public/private subnets, ingress, Next.js hosting mode, Docker compute, TLS, DNS, secrets, IAM, security groups, backups, multi-AZ, infrastructure as code, region, deployment strategy, recovery, and cost through `OQ-015` and `OQ-020`.

## 12. Security architecture

- Authentication proves identity; authorization independently proves organization, branch, and action scope.
- Queries are scoped as a defense-in-depth control, not only filtered after retrieval.
- Registration uses a deterministic process-local in-memory limit of five
  attempts per 15 minutes per canonical email, returns `429` plus `Retry-After`
  when exhausted, and logs neither email nor password. Distributed/IP-aware
  controls and proxy trust remain governed by `OQ-020`.
- Login uses a separate deterministic process-local fixed-window limiter keyed
  by a SHA-256 derivative of canonical email. Five failed credential attempts
  per 15 minutes are processed; subsequent attempts receive `429` plus
  `Retry-After`. Only credential failures count, success does not reset an
  active window, and missing accounts use one fixed dummy Argon2 verifier.
- Verification resend and password-reset request use independent process-local
  fixed-window limiters: three syntactically valid requests per 15 minutes per
  SHA-256-derived canonical-email key. Counting happens before account lookup
  and does not vary by eligibility or provider outcome. Reset completion has no
  MVP limiter and rejects invalid token state before Argon2. These are narrow
  exceptions only; `OQ-020` remains open for distributed/IP/global/provider,
  proxy, multi-instance, production DoS, and telemetry controls.
- Passwords contain 15–128 Unicode code points and are preserved exactly as
  supplied without trimming, normalization, truncation, or composition rules.
  `argon2@0.45.1` creates a PHC-encoded Argon2id verifier with a generated salt,
  `memoryCost=65536` KiB, `timeCost=3`, and `parallelism=4`; plaintext never
  leaves the identity boundary.
- Browser sessions are opaque, hash-only PostgreSQL records carried in HttpOnly cookies; no browser JWT or refresh-token flow exists.
- Email verification, reset, and invitation delivery are routed through the email-provider abstraction; Resend is the production adapter and local/test adapters do not deliver mail.
- Verification, reset, and invitation tokens are opaque, hash-only, single-use, and expiry-bound. Successful reset revokes all sessions; authorization/session checks deny disabled or deauthorized users.
- Secrets stay in an approved secret mechanism and never in repository, images, logs, client bundles, or prompts.
- RDS is not publicly exposed in the intended production design.
- External calls use timeouts, bounded retries, validation, and circuit/budget safeguards appropriate to `OQ-018`.
- AI inputs use data minimization. No individual customer/employee data, raw sales lines, or credentials are sent.
- Structured logs include correlation/context identifiers but exclude sensitive content.
- Cross-organization and unauthorized-branch tests are mandatory.

## 13. Observability architecture

The implementation should emit signals for:

- API request rate, latency, status, and route group
- Authentication failures and rate limiting without logging credentials
- Checkout/receipt success, rollback, conflict, and idempotent replay
- Database connectivity, pool saturation, slow queries, and transaction failures
- Scheduled job start, claim, duration, retry, success, and missed periods
- OpenRouter latency, timeout, failure, invalid response, token/cost usage where available, and fallback
- Snapshot/insight age shown to users

Exact SLOs and alert thresholds are blocked by `OQ-020`. CloudWatch is the accepted production destination.

## 14. Scaling approach

Scale in measured stages:

1. Correct scoped queries, constraints, transactions, and indexes.
2. Paginate lists and avoid N+1 queries.
3. Precompute reusable analytics snapshots.
4. Scale stateless web/API compute within the chosen hosting topology.
5. Tune RDS, connection pools, and read patterns.
6. Introduce SQS only if job duration, concurrency, retries, or backpressure demonstrates a need.
7. Consider service extraction only after a module has proven independent deployment, scaling, or ownership requirements and an accepted ADR.

## 15. Architecture constraints and Open Questions

This document does not answer the following canonical questions from `BUILD_SPEC.md`:

- `OQ-007` negative stock
- `OQ-008` payment/tax/discount/receipt rules
- `OQ-009` refund/void rules
- `OQ-010` costing model
- `OQ-012` forecasting V1
- `OQ-013` stock transfer MVP
- `OQ-015` exact production hosting
- `OQ-016` timezone
- `OQ-017` schedule timing
- `OQ-018` OpenRouter model/fallback/budget
- `OQ-020` production targets
- `OQ-021` receiving lifecycle

Implementation touching one of these areas must stop at its accepted boundary until the referenced question is resolved and all affected documents are updated.
