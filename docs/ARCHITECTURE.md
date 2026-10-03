# StockWise Architecture

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1; implementation verified through P5-M3; refund architecture accepted |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-09-24 |

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

The Next.js/Express shells, operational probes, local PostgreSQL/Prisma foundation, identity/access lifecycle, catalog persistence/API/UI, tenant-safe inventory balance/ledger persistence foundation, read-only branch inventory balance/history API, atomic manual inventory adjustment API, and responsive role-aware branch inventory balance/history/adjustment UI are implemented. Later retail workflows, analytics/AI integration, AWS resources, and production deployment do not exist yet.

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
| Organizations and branches | Tenant lifecycle, branch lifecycle, active/allowed scope resolution, authoritative sales VAT status/rate configuration | Own product, sale, or inventory business rules; accept checkout-authored VAT authority |
| Catalog | Organization products/categories, SKU/barcode rules, accepted master-data lifecycle, one immutable base unit, and organization-level base price data | Hold branch inventory as `product.stock`, cost/valuation authority, branch-price overrides, or rewrite sale history |
| Inventory | Branch balances, append-oriented signed-delta ledger, adjustments, no-negative stock availability, movement history | Change balances without ledger records; permit a negative-stock override; implement generic audit logging |
| Suppliers and purchasing | Organization suppliers, branch-targeted purchase orders, receipt lifecycle | Update inventory outside an atomic receiving use case |
| POS and sales | Server-side cart validation, exact document totals/allocations, atomic completed Sales, immutable line/payment/VAT/COGS snapshots, history, and Sale-backed receipt views; reversal only after rules are accepted | Trust prices/totals/VAT authority from browser; persist a Draft Sale; commit a partial checkout; rewrite original Sale facts for reversal |
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
10. Inventory persistence carries `organization_id` on both balance and ledger rows,
    uses composite Branch/Product tenant foreign keys, and binds ledger actor
    membership to the same organization and actor user at the database boundary.

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
branches. It also returns a server-derived first-organization onboarding
eligibility boolean computed from all membership statuses and durable onboarding
provenance. The response is safe display/navigation data, not a permission token,
and first-organization creation independently rechecks eligibility inside its
transaction.

The Next.js application uses only `/app?organizationId=<id>&branchId=<id>` for
selection. Each load resolves those candidates against the newest access
context, chooses the first code-ascending effective branch when a candidate is
missing or revoked, and replaces the URL with the canonical result. A switch or
revocation cancels and removes the old TanStack Query prefix
`["branch-scoped", organizationId, branchId, ...]` before transition so cached
data from the prior branch cannot render as current. A zero-organization context
enters first setup only when the server eligibility flag is true; otherwise it
renders the safe no-access state.

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
  purchasing/receiving, checkout, sales-history, refund, analytics, forecast/reorder,
  AI-summary, and governance capabilities. `ADR-028` adds refund create/view/cost-view
  authority and deliberately adds no VOID capability. `ADMIN` can manage only non-owner memberships;
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
to Resend, development by default to non-delivery with an explicit Resend opt-in,
and test to non-delivery/recording adapters. A provider
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

### 6.2 Manual inventory adjustment

An authenticated adjustment re-resolves and holds trusted Organization, actor,
Branch, Product, membership, and assignment state for one PostgreSQL transaction.
After exact signed-delta validation, it takes a deterministic organization/key
transaction advisory lock, resolves replay or conflict from the durable ledger,
then takes a deterministic Branch/Product transaction advisory lock. The latter
serializes the lazy missing-row case; an existing `InventoryBalance` is also read
`FOR UPDATE`. The service computes with Prisma Decimal, rejects a negative result,
updates or creates the balance, and appends one `MANUAL_ADJUSTMENT` movement before
commit. Any failure rolls both writes back.

The two advisory-lock classes use SHA-256-derived signed 64-bit keys in disjoint
positive/negative namespaces. A same-class key collision can only serialize
unrelated operations; tenant keys and database uniqueness still determine business
identity. Every adjustment acquires idempotency before balance locks, so identical
and conflicting retries share one lock order. No raw idempotency key or client actor
provenance is persisted.

### 6.3 Purchase receiving

```mermaid
sequenceDiagram
    actor Staff
    participant API as Express API
    participant PUR as Purchasing module
    participant INV as Inventory module
    participant COST as Costing state
    participant DB as PostgreSQL

    Staff->>API: Receive PO quantities for branch
    API->>API: Authenticate, validate, authorize branch
    API->>PUR: Load PO and verify receivable state
    PUR->>DB: Begin transaction
    PUR->>DB: Create receipt and receipt-line snapshots
    PUR->>INV: Record PURCHASE_RECEIVE movements
    INV->>DB: Append ledger entries and update locked balances
    PUR->>COST: Update locked Branch/Product moving-average state
    COST->>DB: Persist cost basis/value/average projection
    PUR->>DB: Update PO/receipt state
    DB-->>PUR: Commit all changes
    PUR-->>API: Completed receipt representation
```

P4-M3-T01 implements this flow behind a service boundary and one PostgreSQL transaction; P4-M3-T02 exposes that service through the authenticated, CSRF-protected receive command without duplicating domain writes. One `ORDERED` PO produces at most one all-at-once immutable receipt; receipt quantities are server-derived from frozen lines; and `DRAFT` → `ORDERED` → `RECEIVED` / `CANCELLED` is the accepted lifecycle. Partial/over/short/multiple receipt, discrepancy handling, receiving without a PO, supplier returns, receipt correction, and receipt reversal are excluded.

Costing is implemented as a Branch/Product projection owned separately from Product catalog data. Receipt `actualUnitCost` is the authoritative intake; PO `expectedUnitCost` remains planning/history data. A first receipt initializes a previously `UNKNOWN` Branch/Product basis for all then-on-hand quantity without inventing or backfilling historical acquisition cost. Before that initialization, cost-dependent valuation/COGS remain unavailable rather than zero. Known-basis manual adjustments use the retained average; reaching zero forces value to zero while retaining that average. Any validation, authorization, state, cost, quantity, or database error rolls back the complete operation.

### 6.4 POS checkout

```mermaid
sequenceDiagram
    actor Cashier
    participant Web
    participant API as Express API
    participant Sales
    participant Inventory
    participant DB as PostgreSQL

    Cashier->>Web: Submit transient cart and payment intent
    Web->>API: POST checkout with idempotency key
    API->>API: Authenticate, validate, authorize branch
    API->>Sales: Invoke checkout with validated intent
    Sales->>DB: Begin transaction
    Sales->>DB: Claim/resolve checkout idempotency
    Sales->>DB: Lock VAT profile; re-load products and exact prices
    Sales->>Sales: Compute document totals and deterministic allocations
    Sales->>DB: Lock sorted Branch/Product balances and cost states
    Sales->>Sales: Enforce stock, discount, VAT, payment, and cost rules
    Sales->>DB: Create Sale, line snapshots, and one Payment
    Sales->>Inventory: Record negative SALE movements
    Inventory->>DB: Append ledger, update balances/cost state
    DB-->>Sales: Commit all changes
    Sales-->>API: Stable sale/receipt response
    API-->>Web: Return same result on safe retry
```

`ADR-027` keeps the mutable cart client-side: no Cart, Draft Sale, or inventory
reservation is persisted. Existence of a Sale row means the checkout transaction
completed successfully; the initial model has no Sale status. Product `basePrice` is
server authority and `expectedUnitPrice` is only an exact optimistic price-change
precondition. The checkout uses THB, one CASH or manually confirmed TRANSFER Payment,
an optional manager-or-higher whole-Sale AMOUNT/PERCENT discount, and a
server-generated immutable `SALE-<UUID>` reference. Sale/SaleItems/Payment are the
receipt source; there is no separate Sales Receipt aggregate or Customer/CRM data.

Organization owns authoritative sales VAT application configuration:
`UNCONFIGURED`, `NOT_REGISTERED`, or `REGISTERED` plus a nullable configured rate.
`UNCONFIGURED` blocks checkout and is not a legal registration classification. A
REGISTERED MVP Organization treats every POS Product as subject to its single rate and
`basePrice` as VAT-inclusive. Discount precedes document-level VAT extraction. A
NOT_REGISTERED Sale has null taxable amounts/rate snapshot and zero Output VAT.
Mixed/product-specific/exempt/zero-rated/multiple-rate tax behavior and a jurisdiction
tax engine are outside MVP.

Document totals use exact Decimal arithmetic, `ROUND_HALF_UP` at the accepted
persisted boundary, and deterministic largest-remainder cent allocation with Product
ID tie-break. Non-negative line allocations enforce discount no greater than gross,
VAT no greater than net, and non-negative net/taxable amounts; line sums must equal
their Sale subtotal, discount, total, taxable, and Output VAT facts as applicable.

Checkout acquires organization/operation idempotency before the existing shared
Branch/Product serialization keys in sorted Product-ID order, then locks balances and
cost states. It atomically creates Sale/SaleItems/one Payment, negative `SALE` ledger
movements, balance changes, cost-state changes, COGS snapshots, and the replay result.
No-negative stock follows `ADR-024`. KNOWN cost retains the accepted moving average.
UNKNOWN cost remains UNKNOWN with null average/value and null SaleItem unit cost/COGS
whether remaining quantity is positive or zero; later receipt initialization never
backfills history. Any failure rolls back every checkout effect.

### 6.5 Sale refund

```mermaid
sequenceDiagram
    actor Manager
    participant Web
    participant API as Express API
    participant Sales
    participant Inventory
    participant DB as PostgreSQL

    Manager->>Web: Submit item refund/restock quantities, reason, payment evidence
    Web->>API: POST Sale refund with Idempotency-Key
    API->>API: Authenticate and validate strict intent
    API->>Sales: Invoke refund for candidate Sale scope
    Sales->>DB: Begin transaction; lock refund idempotency
    Sales->>DB: Revalidate access; lock original Sale
    Sales->>DB: Load original snapshots and prior refunds
    Sales->>Sales: Enforce cumulative quantity and derive money/VAT/cost
    Sales->>DB: Create refund/items and one matching-method payment
    Sales->>Inventory: Restock only positive restock quantities
    Inventory->>DB: Lock sorted products; append return ledger; update balance/cost
    Sales->>DB: Persist replay result and commit all changes
    Sales-->>API: Immutable linked REFUND
    API-->>Web: Return same result on identical retry
```

`ADR-028` adds one linked REFUND concept and no VOID concept. The original
Sale/SaleItems/Payment, negative `SALE` movements, receipt, and historical snapshots
remain immutable. Each refund item has a positive financial quantity and a separately
recorded restock quantity from zero through that amount. Only restock creates a
positive `SALE_REFUND_RETURN` movement in the original active Branch.

Refund money, discount, VAT, taxable value, and COGS derive from cumulative original
SaleItem snapshots; current Product price/VAT configuration/current average never
rewrites history. Returned KNOWN-cost units enter at original unit cost. Mixed UNKNOWN
cost conservatively remains/becomes UNKNOWN except a known-cost return into zero
UNKNOWN quantity may initialize KNOWN. One matching-method manual RefundPayment and
all optional stock/cost effects share the transaction.

Refund concurrency uses Organization idempotency first, then the original Sale row to
serialize cumulative eligibility, then the existing shared Branch/Product locks in
sorted Product-ID order for restock. The API revalidates tenant/branch/role authority
against the persisted Sale. There is no time cutoff, approval chain, gateway, generic
`OQ-019` audit dependency, or dependence on the reporting calendar later fixed by
`ADR-029`.

### 6.6 Deterministic analytics

1. The actor supplies strict local date-only `from`/`to`, granularity, and candidate
   Branch/Organization scope.
2. The API derives active membership/assignments and `BUSINESS_ANALYTICS_VIEW` or
   `INVENTORY_ANALYTICS_VIEW`; cost outputs additionally require `SALES_COST_VIEW`.
3. The period engine loads the Organization IANA timezone and converts aligned local
   day/Monday-week/month/year boundaries to half-open UTC instants with DST rules.
4. One captured event `sourceCutoff` and transactionally consistent read snapshot
   select immutable Sales/refunds/receipts/ledger facts in their own event periods.
   P6-M3-T01 reads mutable current balance/cost state in the same inventory-page
   snapshot and separately labels it `currentSnapshotCapturedAt`; continuation pages
   retain the original event cutoff but capture a new current-state marker. They do
   not reconstruct historical quantity or valuation from current projection rows.
5. SQL performs exact set aggregation; TypeScript applies only accepted Decimal/null/
   coverage formulas and gap-fills canonical buckets.
6. The response includes `analytics-v1`, exact UTC/local period metadata, timezone,
   source cutoff, included authorized Branch scope, completeness, cost coverage, and
   values/null reasons.

`ADR-029` resolves `OQ-011`/`OQ-016`, and `docs/ANALYTICS.md` exclusively owns formulas
and period semantics. Analytics V1 reads normalized operational tables directly; no
warehouse, OLAP service, stream, materialized view, scheduled rollup, or summary table
is introduced before measured need. P6-M3-T01 uses set-based ledger/balance/cost
queries and reconciles the current projection against all ledger deltas visible in
that same read snapshot; it does not compare current balance to an earlier
event-cutoff subset. P7-M1-T02 persists completed-period Sales aggregates as
immutable, versioned AI input snapshots; insight generation remains later work.

### 6.7 Scheduled AI insight

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

Dashboard reads the persisted result. Opening or refreshing the dashboard does not call OpenRouter. `ADR-033` governs V1 schedule times, bounded catch-up, provider, model, budget, and failure behavior.
P7-M2-T02 prepares `ai-business-summary-prompt-v1` transiently from the supported
`analytics-snapshot-v1`/`analytics-v1` Sales payload. Its provider projection uses
only the generic Organization/Branch summary label, cadence, reporting timezone,
persisted local and UTC period bounds, source cutoff, complete status, and the
nine validated Sales fields (including nullable values and reasons). Internal
tenant/Branch/snapshot IDs, names, raw rows, and arbitrary JSON never enter the
prompt. V1 always has available counts and amounts, even for an empty period,
so its all-zero snapshot is not locally insufficient. The output contract is
plain Unicode prose: reject empty, malformed, control-laden, JSON-like,
prompt-marker, or HTML-like text before persistence; the UI must escape
it as text. P7-M4-REM-01 additionally rejects a leading safety-classifier verdict
and requires a Sales metric term from the English vocabulary of the V1 prompt
(sales/refunds/revenue/average order value/COGS/cost/profit/margin/growth).
Invalid prose follows the existing non-retryable `INVALID_RESPONSE` path, with
no persisted summary content; `openrouter/free` routing is unchanged. This
bounded relevance check cannot prove factual accuracy or detect every
invented number; the authoritative snapshot and explicit no-calculation prompt
remain separate controls. Only the prompt version, not its raw text, is
persisted as provenance.
P7-M2-T03 now provides an internal, single-identity report job. It reuses the
immutable AnalyticsSnapshot, pins its schema/metric/source cutoff and prompt
version at claim, and reserves each of at most three provider attempts in
PostgreSQL before network I/O. Completed calls record only safe provenance;
success stores T02-validated plain text. A duplicate observes the existing job.
An expired claim with no reserved call can be reclaimed, while any reserved or
completed provider activity fails closed as `INTERRUPTED` after a crash because
external delivery cannot be proven exactly once. Network I/O never holds a
database transaction open. Public reads remain P7-M3-T02.
An internal Branch status-history lookup supplies due-instant eligibility from
immutable events. Pre-migration history is unknown, so Branch generation skips
due instants before its first trustworthy event; Organization aggregation keeps
its existing historical Branch scope.
P7-M3-T01 provides an internal callable cadence orchestrator with an injected
current instant. For each active Organization it uses the ADR-029 timezone and
period engine to select the two most recent due completed periods per cadence,
oldest first, at 06:00 local time. A missing 06:00 fires at the first valid
instant after the gap; a repeated 06:00 uses its earlier occurrence. Cadences
iterate daily, weekly, monthly, yearly; each period runs the Organization job
first, then Branches in ID order. Branch discovery includes currently active
Branches and Branches with lifecycle events since the oldest candidate due
instant; each Branch is then checked against immutable status history at that
period's original due instant. Unavailable history skips Branch generation.
Each candidate invokes the P7-M2-T03 job sequentially, so its persisted identity
controls duplicates and attempt budgets; one failed candidate does not stop
later candidates. The safe run counts distinguish a persisted failed result
from an unexpected execution error. A future local timer or EventBridge trigger
is only a wake-up signal. Its worker supplies the T03 job and current instant;
the orchestrator determines due periods and scopes. T01 creates no cloud trigger
or replay path.

## 7. Data ownership and module interactions

| Owning module | Owns | Authorized collaborating use cases |
| --- | --- | --- |
| Identity/access | Users, memberships, branch assignments, role policy | All modules ask it to establish/check actor scope |
| Organizations/branches | Organization and branch lifecycle | Catalog/inventory/purchasing/sales validate ownership |
| Catalog | Categories and products | Inventory references product; purchasing/sales snapshot product data |
| Inventory | Balance and transaction ledger | Receiving adds; checkout subtracts; approved reversal compensates |
| Purchasing | Supplier, purchase order, receipt | Receiving coordinates inventory and accepted costing |
| Sales | Completed-by-existence Sale, line/payment/VAT/COGS snapshots, checkout idempotency, Sale-backed receipt projection | Checkout coordinates inventory; a later accepted reversal use case creates linked compensating records without rewriting original facts |
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
- Keep checkout carts transient; render server-returned totals/receipt facts. The later
  POS UI must expose VAT configuration only to `OWNER`/`ADMIN`, block checkout while
  it is unconfigured, and expose discounts only to manager-or-higher roles.
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

The internal AI provider accepts only already-approved text and returns validated
text, actual model, optional reported usage, and sanitized attempt metadata. Its
OpenRouter adapter has a fixed endpoint and requests `openrouter/free` for every
attempt, with no database access or startup call. It retains the valid routed
model identifier as provenance. OpenRouter's generic HTTP 404 is non-retryable.

Avoid a generic repository abstraction that erases query semantics, tenant scope, locking, or transaction requirements.

## 10. Data consistency strategy

### Strong consistency required

- Checkout and inventory deduction
- Receiving and inventory addition
- Adjustments and balance changes
- Refund/payment/restock compensation under `ADR-028`
- Uniqueness and membership constraints
- Idempotent creation of a sale, refund, receipt, snapshot, and scheduled report
- Document-first Sale monetary allocation and one-payment/receipt consistency

### Derived/read models

- `InventoryBalance` is a transactionally maintained projection of ledger movements.
- Inventory mutation establishes/locks the affected branch/product balance inside a
  PostgreSQL transaction, rejects a resulting negative quantity, then updates the
  projection and appends its immutable signed-delta movement atomically. A missing
  balance represents zero and is created lazily only by a successful first movement.
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
- Email verification, reset, and invitation delivery are routed through the email-provider abstraction; production uses Resend, development may explicitly select Resend for manual UAT, and test never delivers mail.
- Verification, reset, and invitation tokens are opaque, hash-only, single-use, and expiry-bound. Successful reset revokes all sessions; authorization/session checks deny disabled or deauthorized users.
- Secrets stay in an approved secret mechanism and never in repository, images, logs, client bundles, or prompts.
- RDS is not publicly exposed in the intended production design.
- OpenRouter calls use the timeout, bounded retries, validation, and budget in `ADR-033`.
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
- OpenRouter latency, timeout, failure, invalid response, token/cost usage where available, and free-router retries
- Snapshot/insight age shown to users

Exact SLOs and alert thresholds are blocked by `OQ-020`. CloudWatch is the accepted production destination.

## 14. Scaling approach

Scale in measured stages:

1. Correct scoped queries, constraints, transactions, and indexes.
2. Paginate lists and avoid N+1 queries.
3. Precompute reusable analytics snapshots only after measured query/schedule need;
   normalized operational facts remain authoritative.
4. Scale stateless web/API compute within the chosen hosting topology.
5. Tune RDS, connection pools, and read patterns.
6. Introduce SQS only if job duration, concurrency, retries, or backpressure demonstrates a need.
7. Consider service extraction only after a module has proven independent deployment, scaling, or ownership requirements and an accepted ADR.

## 15. Architecture constraints and Open Questions

The following canonical questions from `BUILD_SPEC.md` remain open:

- `OQ-015` exact production hosting
- `OQ-020` production targets

Implementation touching one of these areas must stop at its accepted boundary until the referenced question is resolved and all affected documents are updated.
`ADR-030` separately accepts only P6-M3-T02's fixed coverage-based
Branch/Product classification. `ADR-031` closes `OQ-012` for Forecasting V1:
on-demand normalized-table SQL/TypeScript in the existing analytics module,
with no new schema/service. `ADR-032` separately accepts advisory Reorder V1
policy, implemented as an internal runtime by P6-M4-T03. Forecast-derived
stockout risk still needs a separate accepted policy; P6-M4-T04 owns API/UI
exposure for forecast and reorder.

`ADR-029` resolves `OQ-011` and `OQ-016` with one configurable Organization IANA
timezone, event-period attribution, canonical half-open periods, accepted Analytics V1
metrics, explicit threshold deferrals, exact decimal/null semantics, and direct
normalized-table query authority. P6-M1-T01 creates no runtime/schema/API/UI behavior;
P6-M1-T02 implements the internal reporting-time/period/scope foundation. P6-M2-T01
adds the internal set-based base Sales metric repository/service without an endpoint;
P6-M2-T02 adds internal Category and Branch dimensions; P6-M2-T03 exposes Sales,
Category, and Branch Analytics through HTTP and the responsive Analytics UI.

Sales payment, Output VAT, discount, receipt, monetary, checkout, and UNKNOWN-cost
behavior are accepted by `ADR-027`, which resolves `OQ-008`. P5-M1 and P5-M2 implement
Sales persistence, checkout, HTTP, and POS UI; P5-M3 implements history/detail/browser
receipt. `ADR-028` resolves `OQ-009` with linked REFUND compensation, optional
same-branch restock, historical allocation/cost authority, and no VOID operation.
P5-M4-T01 accepted the decision contract, and P5-M4-T02 implements the bounded
refund persistence, atomic service, authenticated API, history projection, and
responsive UI without a VOID operation.

Purchasing/receiving costing and receipt lifecycle are accepted by `ADR-026`.
P4-M3-T01 implements Receipt persistence, the atomic receiving service, and the
documented `UNKNOWN`/`KNOWN` cost-basis projection. P4-M3-T02 implements the
authenticated Receiving API, and P4-M3-T03 implements the responsive Receiving UI
over that command. No Purchase Receipt read/history endpoint exists.

Stock transfer is **DEFERRED FROM MVP** by `ADR-025`. It remains broader/full future
scope, but no transfer component, API, persistence, authorization, lifecycle, or
ledger contract is part of the current architecture. Any future direction must be
re-reviewed before implementation.
