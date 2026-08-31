# StockWise Build Specification

| Field | Value |
| --- | --- |
| Product | **StockWise** |
| Full name | StockWise: Smart Inventory and Sales Analytics Platform for SMEs |
| Repository | `stockwise` pnpm workspace monorepo |
| Baseline | Architecture Freeze v1 |
| Status | Repository foundation, web/API shells, identity/access lifecycle, and organization catalog persistence implemented; later domain implementation remains gated by explicit decisions |
| Last updated | 2026-08-25 |

## 1. Purpose and source-of-truth map

This document is the product contract: it defines what StockWise is, who it serves, what it must do, and what it explicitly does not do.

Each topic has one authoritative owner. Other documents link to that owner instead of creating a second definition.

| Topic | Authoritative document |
| --- | --- |
| Product scope, goals, roles, requirements, non-goals, master open questions | `BUILD_SPEC.md` |
| Developer execution rules and Definition of Done | `AGENTS.md` |
| System boundaries and component responsibilities | `docs/ARCHITECTURE.md` |
| Logical data model, constraints, lifecycle, and transaction invariants | `docs/DATABASE.md` |
| Metric and formula definitions, forecasting, report periods, AI snapshot contract | `docs/ANALYTICS.md` |
| User-visible behavior and edge cases | `USE_CASE_SPECS.md` |
| REST resource and HTTP contracts | `docs/API.md` |
| Delivery order and status | `PROJECT_PLAN.md` |
| Architecture decision history and rationale | `docs/DECISIONS.md` |

An accepted change must update every affected authoritative document in the same change. Do not resolve uncertainty in code. Add or update an Open Question first.

## 2. Decision vocabulary

- **Product decision:** what value or behavior the product provides.
- **Architecture decision:** a durable system boundary, technology choice, or invariant.
- **Implementation detail:** a local code-level choice that may be made within accepted product and architecture constraints.
- **Open Question:** a decision that is intentionally unresolved and must not be guessed by an implementer.

## 3. Product overview

StockWise is a cloud-based retail operations platform for small and medium-sized businesses. It combines point of sale, organization-wide product management, branch-level inventory and purchasing operations, sales history, deterministic analytics, forecasting, replenishment guidance, and scheduled natural-language summaries.

It is delivered as a responsive web application usable from desktop, tablet, and phone browsers. A native mobile application is not part of the current scope.

StockWise is not a full ERP. Its scope is the retail flow:

`Product -> Purchase -> Receive -> Branch inventory -> POS sale -> Sales history -> Analytics -> Replenishment guidance -> Scheduled AI summary`

## 4. Problem statement

Small retailers often cannot justify a custom POS, inventory, purchasing, and analytics system. They may use disconnected tools or manual records, making it difficult to answer:

- What is currently in stock at each branch?
- Why did a stock balance change?
- What sold, where, when, and by whom?
- What should be reordered and when?
- Which trends matter at branch and organization level?
- How can an owner understand these results without reading many charts?

StockWise must provide one consistent operational record and decision-support layer without requiring enterprise infrastructure or specialist data staff.

## 5. Goals

1. Support the end-to-end retail workflow from purchasing and receiving through checkout and analytics.
2. Isolate each business as an `Organization` tenant and support multiple `Branch` operations from the beginning.
3. Make stock changes traceable through an inventory ledger and safe under concurrent operations.
4. Preserve accurate historical sales even when current product data changes.
5. Calculate analytics and forecasts deterministically in TypeScript and SQL, with testable formulas.
6. Use OpenRouter only to turn precomputed aggregate analytics into scheduled, persisted summaries.
7. Provide a responsive browser experience suitable for PCs, tablets, and phones.
8. Produce a maintainable cloud-ready system that can progress from MVP to production hardening without a rewrite.
9. Include measurable software/cloud experiments, documented limitations, and cost analysis as part of the project delivery.

## 6. Non-goals

The following are not part of the current product scope:

- Expense management, general accounting, tax accounting, or a full ERP ledger
- HR or payroll
- Native Android or iOS applications
- Microservices
- Kubernetes
- A Python or FastAPI analytics service
- Real-time or user-triggered LLM generation
- Using an LLM as a forecasting, arithmetic, stock-decision, or transaction engine
- An AI chatbot
- Offline POS
- Full CRM, loyalty, e-commerce, or enterprise warehouse management
- Google login in the MVP; it may be evaluated after the core project

Stock transfer is deferred from the current MVP but remains broader/full product scope; no transfer lifecycle or implementation contract is frozen. Branch price overrides, refunds/voids, and particular payment methods are neither silently included nor excluded; their MVP status is unresolved in the Open Questions register.

## 7. Target users

- Small retail shops and grocery stores
- Small-to-medium multi-branch retailers
- SME owners who cannot fund a custom retail platform
- Store managers, inventory staff, and cashiers who need role- and branch-scoped access

The product is retail-focused. It does not attempt to support every business type.

## 8. User roles and scope

The accepted authorization model is RBAC plus branch scope. A single user account can access multiple branches.

| Role | Default scope | Intended responsibilities |
| --- | --- | --- |
| `OWNER` | Organization | Full business visibility and governance |
| `ADMIN` | Organization | Organization administration delegated by an owner |
| `BRANCH_MANAGER` | Assigned branches | Branch operations and reporting |
| `INVENTORY_STAFF` | Assigned branches | Products as permitted, purchasing, receiving, stock operations |
| `CASHIER` | Assigned branches | POS checkout and permitted sales-history actions |

These five role names are the accepted MVP RBAC policy and must not be renamed casually. Each user has one organization role per organization; `OWNER` and `ADMIN` have organization-wide branch access, while `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER` require explicit branch assignments and may be assigned to multiple branches. A user may hold different organization roles in different organizations. Server-side policy must deny by default and check organization membership, required branch assignment, role, action, and resource ownership; frontend checks are UX only.

The MVP permission baseline is:

| Capability | Authorized roles and scope |
| --- | --- |
| Product/category view; inventory view | All roles, within allowed organization/branch scope |
| Product/category create or edit; supplier create or edit; stock adjustment; purchase orders/receiving | `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`; branch-only roles are limited to assigned branches |
| Product deactivate | `OWNER`, `ADMIN`, `BRANCH_MANAGER`; branch managers are limited to assigned branches |
| POS/checkout | `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `CASHIER`; branch-only roles are limited to assigned branches |
| Sales history | `OWNER`/`ADMIN` organization-wide; `BRANCH_MANAGER` and `CASHIER` in their assigned-branch scope as required for operations |
| Analytics | `OWNER`/`ADMIN` organization-wide; `BRANCH_MANAGER` assigned branches; `INVENTORY_STAFF` inventory-relevant analytics only; `CASHIER` none |
| Forecast/reorder | `OWNER`/`ADMIN` organization-wide; `BRANCH_MANAGER`/`INVENTORY_STAFF` assigned branches; `CASHIER` none |
| AI business summaries | `OWNER`/`ADMIN` organization-wide; `BRANCH_MANAGER` assigned branches; `INVENTORY_STAFF`/`CASHIER` none |

`OWNER` has full organization operational access, manages owners, and performs OWNER-only ownership actions. `ADMIN` manages branches and non-owner memberships but cannot promote to OWNER, demote/remove an OWNER, transfer ownership, or perform OWNER-only destructive ownership actions. `BRANCH_MANAGER` cannot manage organization settings, create/delete branches, or administer users/roles. `INVENTORY_STAFF` cannot check out, administer employees, access broad analytics, or view management AI summaries. `CASHIER` cannot edit products, adjust stock, manage purchasing/suppliers, access analytics/forecasting/AI insights, or administer employees. At least one OWNER must always remain; an OWNER cannot remove, demote, or leave if that would leave no OWNER. Refund/void permission remains unresolved in `OQ-009`.

## 9. Tenant and operational model

- `Organization` is the tenant and business ownership boundary.
- An organization has one or more branches.
- `Branch` is the operational boundary for inventory, sales, POS, and purchase receiving.
- A product catalog and suppliers belong to an organization.
- Inventory balances and inventory transactions belong to a branch and product.
- Every sale belongs to exactly one branch and records the acting user.
- Every purchase order and receipt targets a branch.
- Users can belong to an organization and be assigned to one or more branches.
- Organization-wide views aggregate only branches the user is authorized to access.
- The client must never be trusted to establish `organizationId`, `branchId`, price, cost, totals, or permissions.

## 10. Core product capabilities

### 10.1 Identity, organization, and branches

- Register with only email and password; complete the required user profile after registration.
- Preserve passwords exactly as submitted and hash them as PHC-encoded Argon2id
  using `argon2@0.45.1`, `memoryCost=65536` KiB, `timeCost=3`, and
  `parallelism=4`; never store plaintext or reversible passwords.
- Create a new organization through the accepted onboarding flow or join one through an accepted invitation.
- Create and manage branches with authorized roles.
- Assign users to organization and branch scopes.
- Switch active branch without signing in again.
- View an allowed organization-level aggregate when the role permits it.
- Use opaque server-side sessions backed by PostgreSQL: a cryptographically random browser token is stored only in an HttpOnly cookie and only its cryptographic hash is stored in the database.
- Verify email/password accounts, support safe password recovery, and deliver production mail through the Resend-backed email-provider abstraction.
- Invite employees by email with an expiring, single-use invitation that establishes the accepted organization role and branch scope atomically.
- Sign out by revoking the current session; support revoking all sessions for a user.

Branch management is fixed by `ADR-020`. After first onboarding, an authorized
`OWNER` or `ADMIN` supplies a code that is trimmed, uppercased, 1–16 characters,
starts with an ASCII alphanumeric character, and otherwise contains only ASCII
alphanumeric characters, `_`, or `-`. Codes are unique per organization and
immutable; `MAIN` is not globally reserved. Branches are activated/deactivated,
never deleted. Every edit or lifecycle command carries the exact prior
millisecond UTC `updatedAt`; stale commands fail rather than overwrite.

Application organization/branch selection lives only in `/app` URL query
parameters and is re-resolved from the freshly fetched server access context.
It is navigation state, never authentication or authorization evidence. The
browser stores no selected organization/branch in a session, user row, cookie,
`localStorage`, or `sessionStorage`.

Membership access management is fixed by `ADR-021`. `OWNER` may invite and
manage every accepted role; `ADMIN` may invite and manage only non-owner roles.
An invitation is allowed only when no membership of any status exists for the
canonical email in that organization. Reissue always replaces the prior open
invitation with a fresh seven-day hash-only token. Acceptance requires the
authenticated, verified, canonical invited email and atomically creates exactly
one membership, the full branch scope, source-invitation provenance, and a
bounded access event. A same-user replay returns the existing logical result
without another mutation.

Membership role/scope edits and reactivation are full desired-state
replacements protected by the exact prior millisecond UTC `updatedAt`.
Organization-wide roles have no effective assignments; branch-only roles need
at least one active same-organization branch. Deactivation preserves configured
assignment rows, grants no access immediately, and does not globally revoke the
user's sessions. Every later authorization request re-evaluates membership
state. Organization-row serialization prevents concurrent changes from leaving
zero active owners.

Google login is a future feature. No JWT browser authentication, browser token storage in `localStorage`/`sessionStorage`, refresh-token flow, automatic invitation account creation, or naive cross-email account linking is part of the MVP.

### 10.2 Product catalog

- Manage organization-level categories and products.
- Store SKU, optional barcode, name, description, one immutable base unit, product status, and one organization-level base selling price. Product has no organization-wide cost, valuation, or COGS field; future Branch/Product cost state follows `ADR-026`.
- Enforce organization-scoped SKU and barcode uniqueness rules.
- Search and filter products for management and POS use.
- Preserve past sale snapshots when current product details change.

P3-M1-T02 implements only the organization-scoped Category/Product persistence
foundation, accepted normalization helpers, tenant uniqueness, composite
Category ownership, lifecycle enums, base price, and base unit. Catalog REST
management/search remains P3-M1-T03; no inventory, cost/valuation, branch-price,
or operational quantity persistence is part of the catalog model.

Branch-level price overrides are out of MVP scope. Every branch uses the Product's organization-level base selling price; a catalog-price change affects future operations only, and future sale items must snapshot the actual unit price used at sale time.

### 10.3 Branch inventory

- Read current product balances by branch.
- Record every stock change as an append-oriented inventory transaction.
- Maintain a query-efficient balance projection consistent with the ledger.
- Receive stock, sell stock, adjust stock, and record reversals when the relevant business rules allow them.
- Show inventory history and low-stock information.
- Prevent lost updates and overselling: MVP never permits a resulting negative
  balance, and no role has an override.

The stock-transfer MVP scope is deferred by `ADR-025`. The implemented inventory
foundation remains quantity-only; `ADR-026` defines future Branch/Product costing
without asserting that cost or valuation persistence already exists.

### 10.4 Suppliers and purchasing

- Manage organization-level suppliers.
- Create purchase orders for a target branch.
- Add purchase-order line items and follow the `DRAFT` → `ORDERED` → `RECEIVED` / `CANCELLED` lifecycle accepted by `ADR-026`.
- Receive goods all at once from one ordered PO into its target branch; the server derives receipt quantity from frozen PO quantities.
- Support an atomic receipt that creates receipt records, ledger entries, balance changes, Branch/Product moving-average cost changes, and the PO transition together.
- Preserve historical purchase and receipt values independently of current product values.

Partial/over/short receipt, multiple receipt events, receiving without a PO, supplier returns, and receipt reversal are excluded from MVP. The exact future cost-state schema remains a later implementation decision, but must preserve `UNKNOWN` versus `KNOWN` cost basis semantics from `ADR-026`.

### 10.5 POS and sales

- Search products and accept barcode input.
- Build and validate a cart.
- Recalculate prices and totals on the server.
- Record payment information according to the finalized MVP payment scope.
- Create the sale, immutable sale-item snapshots, payment records, inventory transactions, and inventory balance updates in one database transaction.
- Roll back the whole checkout if any required operation fails.
- View branch-scoped sales history, sale details, and a printable browser receipt.
- Apply refund/void behavior only after its rules are accepted.

Payment methods, tax/VAT behavior, discounts, receipt numbering, refunds, and voids must not be invented during implementation.

### 10.6 Analytics and forecasting

- Calculate sales and inventory metrics using the definitions in `docs/ANALYTICS.md`.
- Support branch-level results and authorized organization-level aggregation.
- Support daily, weekly, monthly, and yearly reporting periods.
- Provide sales totals, units, transaction counts, average order value, category performance, branch performance, trends, and movement indicators.
- Provide stock coverage, low-stock/stockout risk, overstock risk, and replenishment guidance once their exact definitions are accepted.
- Calculate forecasting in the application using TypeScript and SQL. No Python service is used now.
- Retain reproducible metric inputs or snapshots needed for reports and experiments.
- Compare forecast results with actual values using accepted evaluation metrics.

Several formulas are deliberately unresolved. `docs/ANALYTICS.md` is the only place where their accepted definitions may be finalized.

### 10.7 Scheduled AI summaries

- Generate four report cadences: daily, weekly, monthly, and yearly.
- Build an aggregate analytics snapshot before contacting OpenRouter.
- Send no customer-level personal data, raw transaction records, secrets, or database access to OpenRouter.
- Ask OpenRouter to summarize the supplied facts, not to calculate metrics or forecast demand.
- Persist the generated insight and its provenance so dashboards read a cached result rather than invoking the provider.
- Make scheduled generation idempotent and resilient to provider failure.
- Preserve the last successful insight and surface stale/failed status without blocking core retail workflows.

Exact schedule times, model selection, fallback policy, retention, and organization timezone behavior are open questions.

### 10.8 Cloud and operations

The accepted AWS building blocks are:

- Amazon RDS for PostgreSQL
- Amazon S3 for object storage when product or report assets require it
- Amazon VPC for production network isolation
- Amazon CloudWatch for logs, metrics, and alerts
- Amazon EventBridge for production schedules
- Docker for application packaging
- GitHub Actions for CI/CD
- Amazon SQS only when asynchronous workload complexity or scale justifies it

SQS is not a mandatory MVP dependency. Exact frontend/backend hosting, ingress, secrets management, infrastructure-as-code tooling, regions, availability strategy, and cost targets remain open.

## 11. Functional requirements

Identifiers below are stable references for plans, use cases, tests, and APIs.

### Identity and authorization

- **FR-IAM-001:** The system shall register and authenticate MVP users with email and password. Registration accepts no profile, organization, or branch field.
- **FR-IAM-002:** The system shall store PHC-encoded Argon2id password verifiers created by `argon2@0.45.1` with `memoryCost=65536` KiB, `timeCost=3`, `parallelism=4`, and a library-generated random salt.
- **FR-IAM-003:** The system shall authorize every business operation by organization membership, branch scope where applicable, and role permission.
- **FR-IAM-004:** One user shall be able to access multiple authorized branches using one account.
- **FR-IAM-005:** A user shall not access a tenant, branch, or aggregate outside their authorization scope.
- **FR-IAM-006:** Browser authentication shall use a cryptographically random opaque session token in an HttpOnly cookie; PostgreSQL stores only its hash and the API authorizes every protected request server-side.
- **FR-IAM-007:** Sessions shall rotate on successful authentication, expire after configurable sliding 24-hour idle and fixed seven-day absolute baselines, and be revocable individually or for all user sessions. Valid authenticated activity persists a touch at most once per 15 minutes and never extends absolute expiry.
- **FR-IAM-008:** Email/password accounts shall verify email before access; verification, reset, and invitation tokens shall be opaque, cryptographically random, hashed at rest, single-use, and expiry-bound.
- **FR-IAM-009:** New-organization onboarding shall require display name, organization name, and initial branch name, create the creator's `OWNER` membership atomically, and collect only the approved optional profile/branch phone and branch-address fields.
- **FR-IAM-010:** Invitations shall be email-bound, require authentication and verified ownership of the invited email before acceptance, and create the organization membership and branch assignments atomically and idempotently.

First-organization onboarding is a one-time, authenticated, verified-user flow.
The initial branch code is the server-owned constant `MAIN` and is never an
input or name-derived value. Required onboarding text is boundary-trimmed and
must remain nonblank; optional phone/address text is boundary-trimmed and blank
becomes `NULL`. Internal whitespace and Unicode representation are preserved.
A persisted `FirstOrganizationOnboarding` record keyed uniquely by platform
user stores the organization, same-organization branch, SHA-256 canonical
request hash, and completion time. With no provenance, any existing membership
of any status blocks the flow, while a pending invitation alone does not.
Identical retries recover the original logical result; a different retry or a
membership-only account receives the accepted conflict without mutation.

Registration passwords contain 15–128 Unicode code points. The API preserves
the submitted string exactly: it does not trim, Unicode-normalize, silently
truncate, or impose uppercase, lowercase, digit, or symbol composition rules.
Whitespace and Unicode are allowed. Breached-password screening is deferred.

P2-M2-T01 creates the platform user with `emailVerifiedAt = null` but creates no
verification token and sends no email. P2-M2-T03 owns verification-token
creation, resend, provider integration/delivery, and verification behavior.

P2-M2-T02 login permits five failed credential attempts per canonical email per
fixed 15-minute process-local window. Only credential failures count; a success
does not reset the active counter/window. After five failures, later attempts in
the window return `429` with `Retry-After`. Missing-account login runs the same
Argon2 verification path against one fixed valid dummy PHC hash. Distributed,
IP-aware, global controls and proxy trust remain open under `OQ-020`.
New and canonical-email duplicate registration attempts return the same generic
`202 Accepted` public response; the database unique constraint remains the
final race-safe email boundary. Registration permits five attempts per 15
minutes per canonical email through a deterministic process-local in-memory
limiter. Exhaustion returns `429` with `Retry-After`; distributed and IP-aware
controls remain part of `OQ-020`.

P2-M2-T03 adds two narrow MVP abuse-control exceptions without resolving
`OQ-020`: verification resend and password-reset request each permit three
syntactically valid requests per canonical email per fixed 15-minute
process-local window. Each valid request consumes an attempt before account
lookup, regardless of account state or provider outcome; the SHA-256-derived
limiter key contains no plaintext email. The fourth and later requests return
`429` with deterministic `Retry-After`. Malformed email allocates no limiter
entry. Reset completion has no process-local token-keyed limiter: malformed,
unknown, expired, revoked, replaced, and consumed tokens are rejected before
Argon2. Distributed, IP-aware, global/provider-wide, proxy-trust,
multi-instance, production DoS, and long-term telemetry controls remain open in
`OQ-020`.

### Catalog and inventory

- **FR-CAT-001:** Products and categories shall be scoped to one organization.
- **FR-CAT-002:** SKU and barcode constraints shall be enforced within the owning organization according to `docs/DATABASE.md`.
- **FR-CAT-003:** A Product shall use exactly one immutable MVP base unit from the accepted vocabulary; quantity input is a decimal string with accepted precision and is rejected rather than rounded when invalid.
- **FR-CAT-004:** A Product shall have one organization-level non-negative base price represented by a decimal string with at most four fractional digits; it is not a branch-price override or final sales-transaction rounding rule.
- **FR-CAT-005:** Product and Category mutations shall use exact `updatedAt` optimistic concurrency and preserve historical references through lifecycle status rather than hard deletion.
- **FR-INV-001:** Stock shall be represented by both a current balance and traceable inventory transactions.
- **FR-INV-002:** Every balance mutation shall have a corresponding ledger entry created atomically.
- **FR-INV-003:** Inventory shall be scoped to a branch.
- **FR-INV-004:** A successful stock mutation shall use a signed decimal-string delta,
  atomically update the balance projection and append exactly one immutable ledger
  movement, and never leave a resulting quantity below zero.
- **FR-INV-005:** Inventory mutations shall serialize the authoritative
  branch/product balance inside PostgreSQL; a failed insufficient-stock attempt
  creates neither a ledger row nor a durable balance change.

### Purchasing

- **FR-PUR-001:** Suppliers shall be scoped to an organization.
- **FR-PUR-002:** Purchase orders and receipts shall target a branch in the same organization.
- **FR-PUR-003:** A PO shall use the accepted immutable lifecycle and one unique Product line per PO; an ordered PO produces at most one immutable completed receipt.
- **FR-PUR-004:** Receiving shall derive exact receipt quantities from the frozen PO, atomically update receipt state, ledger, balances, Branch/Product cost state, and PO state, and use receipt-level idempotency.
- **FR-PUR-005:** Purchasing uses THB only. PO/Receipt unit costs use decimal strings targeting `DECIMAL(19,4)`; future moving-average unit cost targets `DECIMAL(19,6)` and uses `ROUND_HALF_UP` where a persisted/displayed scale requires rounding.
- **FR-PUR-006:** A receipt may preserve only the accepted document-level Input VAT snapshots; it shall not imply a generic Tax engine, VAT allocation engine, Output VAT, or tax reporting.

### Sales

- **FR-SALE-001:** Every sale shall be assigned to one branch and acting user.
- **FR-SALE-002:** Checkout shall validate authorization, product status, server-side price, totals, and stock policy.
- **FR-SALE-003:** Checkout shall commit the sale, immutable line snapshots, payment, ledger, and balances as one database transaction.
- **FR-SALE-004:** Historical sale line values shall not change when catalog data changes.
- **FR-SALE-005:** Duplicate checkout submission shall not create duplicate sales when the same idempotency key is retried.

### Analytics and AI

- **FR-AN-001:** Metric outputs shall be derived only from definitions in `docs/ANALYTICS.md`.
- **FR-AN-002:** Organization results shall aggregate authorized branch results without cross-tenant leakage.
- **FR-AN-003:** Forecasting and replenishment calculations shall run in deterministic application/database logic, not an LLM.
- **FR-AI-001:** AI reports shall be scheduled for daily, weekly, monthly, and yearly periods.
- **FR-AI-002:** OpenRouter shall receive only minimized aggregate snapshots.
- **FR-AI-003:** AI output shall be persisted and served without an on-demand provider call.
- **FR-AI-004:** Provider failure shall not block sales, stock, purchasing, or deterministic analytics.

## 12. Non-functional requirements

### Security

- Enforce tenant and branch authorization on the server for every business request and background job.
- Derive trusted scope from authenticated membership; never trust a client-supplied tenant identifier alone.
- Validate all untrusted request and environment input with Zod at system boundaries.
- Apply the accepted registration password, Argon2id, duplicate-response, and process-local rate-limit baseline above; do not log submitted email or password values.
- Keep secrets out of source, logs, error responses, analytics snapshots, AI prompts, and client bundles.
- Minimize data sent to OpenRouter and prohibit personally identifiable customer or employee data.
- Use least-privilege AWS identities, private database networking, encryption in transit, and managed encryption at rest.
- Record security-sensitive and stock-affecting actor/context data; the full audit-log product scope is open.

### Data integrity

- Use PostgreSQL transactions for checkout, receiving, adjustments, and reversals.
- Represent money and unit costs with PostgreSQL `NUMERIC`/`DECIMAL` and Prisma `Decimal`; do not use unbounded binary floating-point arithmetic for money.
- Use database constraints in addition to application validation.
- Use timestamps in UTC; organization display/report timezone behavior is unresolved.
- Make scheduled reports and retried write requests idempotent.

### Maintainability

- Use a modular monolith with explicit domain boundaries and no circular domain dependencies.
- Keep controllers thin; business rules belong to services/use cases and data access behind module boundaries.
- Share contracts deliberately; do not create a catch-all shared package.
- Add dependencies only when a standard API or existing dependency does not reasonably solve the problem.
- Keep product, architecture, data, metric, API, use-case, and delivery documentation consistent with accepted changes.

### Reliability and observability

- Core retail workflows shall continue if OpenRouter is unavailable.
- Emit structured logs without secrets or personal data.
- Expose application health/readiness signals appropriate to the deployment.
- Monitor failed checkouts, failed receipts, scheduled-job failures, OpenRouter errors, and database saturation.
- Define backup, restore, recovery, and alert thresholds before production launch.

### Performance

- Design indexes and pagination for organization- and branch-scoped access patterns.
- Do not compute large dashboard aggregates synchronously on every page load when a reusable snapshot is appropriate.
- Numeric service-level targets are an Open Question and must be set before load-test acceptance.

### Accessibility and responsiveness

- Support current desktop, tablet, and mobile browser layouts.
- Meet WCAG 2.1 AA intent for keyboard access, semantic controls, focus visibility, labels, and contrast.
- POS interactions must remain usable on touch screens.

### Testing and experimentation

- Test domain rules, validation, authorization, tenant isolation, branch isolation, and failure paths.
- Include database-backed integration tests for atomic stock, receiving, checkout, idempotency, and concurrency.
- Include frontend component/integration tests and critical end-to-end workflows.
- Verify analytics formulas against fixed fixtures and known results.
- Compare forecasting candidates against a documented baseline using accepted evaluation metrics and reproducible synthetic or anonymized data.
- Include cloud deployment validation, limitations, and cost analysis in project delivery.

## 13. Technology baseline

| Layer | Accepted choice | Decision type |
| --- | --- | --- |
| Frontend | Next.js + TypeScript | Architecture |
| Backend | Express.js + TypeScript | Architecture |
| API | REST, versioned under `/api/v1` | Architecture |
| Database | PostgreSQL | Architecture |
| ORM/migrations | Prisma | Implementation baseline |
| Validation | Zod | Implementation baseline |
| UI | Tailwind CSS + shadcn/ui | Implementation baseline |
| Charts | Recharts | Implementation baseline |
| Server state | TanStack Query | Implementation baseline |
| Password hashing | Argon2 | Security baseline |
| AI provider | OpenRouter API, summaries only | Architecture |
| Packaging | Docker | Architecture |
| CI/CD | GitHub Actions | Implementation baseline |
| Production services | AWS RDS, S3, VPC, CloudWatch, EventBridge; SQS if justified | Architecture |

Python, FastAPI, microservices, and Kubernetes are not part of the current baseline.

## 14. Important constraints

1. This repository contains the approved repository/tooling foundation, Next.js web and Express API shells, completed identity/access lifecycle, and the organization-scoped Category/Product persistence model. Catalog APIs/UI and later retail-domain, analytics, AI, and cloud implementation remain planned.
2. Product requirements and architecture decisions are made in planning and recorded here before Codex implements them.
3. Codex may choose local implementation details only inside accepted boundaries; it must surface product or architecture ambiguity.
4. Significant domain implementation must not start until the Critical Domain Decision Gate and every additional task-specific Open Question affecting that domain are resolved.
5. Do not expose tenant identifiers as authorization shortcuts.
6. Do not mutate stock without a ledger entry and an atomic balance update.
7. Do not use an LLM for numerical truth, forecasting, transaction decisions, or database access.
8. Do not add AWS services merely to appear cloud-native; use SQS and other optional services only with a demonstrated need.

## 15. Critical Domain Decision Gate

The accepted architecture can remain frozen while product/domain decisions are open, but Codex must not invent those decisions during implementation. Repository/tooling work and unrelated application-shell work may continue when their own blockers are resolved.

These decisions are mandatory gates before the affected domain implementation:

| Affected domain | Required accepted decisions before implementation |
| --- | --- |
| Authentication and authenticated state | `ADR-013` (`OQ-003` resolved) |
| Email verification, password reset, and invitations | `ADR-014`, `ADR-021` (`OQ-004`, `OQ-006` resolved) |
| Profile and organization/first-branch onboarding | `ADR-015` (`OQ-005` resolved) |
| Authorization policies for accepted MVP roles | `ADR-016` (`OQ-022` resolved) |
| Catalog schema and management API | `ADR-022` (`OQ-014`, `OQ-023`, `OQ-024` resolved); Product retains no organization-wide cost/valuation field; later Branch/Product cost state follows `ADR-026` |
| Inventory mutations and stock availability | `ADR-024` plus the accepted quantity contract in `ADR-022` |
| POS checkout and sales monetary truth | `ADR-024`, `ADR-026`, `OQ-008` plus `ADR-016` and the accepted quantity contract in `ADR-022` |
| Refund and void | `OQ-009` plus the applicable sales decisions |
| Purchasing/receiving behavior | `ADR-024`, `ADR-026` plus the accepted quantity contract in `ADR-022` |
| Analytics definitions | `OQ-011` |
| Forecasting V1 and reorder recommendation | `OQ-011`, `OQ-012` plus accepted costing/quantity inputs where used |

Other questions remain task-specific. In particular, exact AWS topology, scheduled-report times, OpenRouter model/fallback, audit-log hardening, and performance/recovery targets may remain open until their relevant phases; they do not block Repository Foundation or unrelated implementation.

## 16. Decision and Open Questions register

This is the canonical list. Other documents reference these IDs and must not redefine or answer them independently.

### Resolved decisions

| ID | Accepted answer | Decision record |
| --- | --- | --- |
| **OQ-001** | Use a native pnpm workspace on Node.js 24 LTS. Runtime applications use `apps/web` and `apps/api`; deliberately shared internal packages may use `packages/*` only when justified. Use one root lockfile and no monorepo orchestration framework until a measured need exists. | `ADR-011` |
| **OQ-002** | Use the Next.js App Router with the `src/app` directory convention. React Server Components are the default; use Client Components only for required client-side behavior. Route Groups may be added later only for implemented routes. StockWise business REST APIs remain in Express and must not be implemented as Next.js Route Handlers. | `ADR-012` |
| **OQ-003** | Use opaque PostgreSQL-backed server-side sessions. Send a cryptographically random session token only in the `stockwise_session` HttpOnly, host-only, `SameSite=Lax`, `Path=/` cookie (`Secure` in production, not local HTTP); store only its cryptographic hash. Do not use browser JWTs, `localStorage`/`sessionStorage`, or refresh tokens. Successful authentication creates a fresh token and atomically revokes a currently valid same-user cookie session as `login_rotation`. Enforce server-side authorization, configurable sliding 24-hour idle and fixed seven-day absolute expiry baselines, and at most one persisted activity touch per 15 minutes. | `ADR-013` |
| **OQ-004** | Require email verification for email/password accounts. P2-M2-T01 creates an unverified account but no verification token and sends no email; P2-M2-T03 owns token creation, resend, provider integration/delivery, and verification. Verification and reset tokens are opaque, cryptographically random, hash-only, single-use tokens with 24-hour and 30-minute expiry respectively; resend replaces the active verification token; reset revokes all sessions; forgot-password responses are non-disclosing. | `ADR-014`, `ADR-017` |
| **OQ-005** | Registration accepts only email and password. The platform profile later requires display name, so `User.displayName` remains nullable until profile/onboarding; no placeholder is derived from email. New-organization onboarding requires display name, organization name, and initial branch name. Phone is optional for the platform profile and initial branch; branch address is optional. The creator becomes `OWNER`; the server assigns initial branch code `MAIN`. One persisted per-user provenance row provides request-hash replay and concurrency identity; zero memberships are required when that row does not exist. User identity is platform-level; access derives from memberships. Invitations use their own flow. | `ADR-015`, `ADR-017`, `ADR-019` |
| **OQ-006** | Use email-bound organization invitations carrying the intended role and branch scope. Their opaque, cryptographically random, hash-only token is single-use for access creation and expires in seven days; reissue invalidates the active invite. The invited email must authenticate and verify before transactional acceptance creates membership, branch assignments, source provenance, and a bounded access event. Same-actor replay returns the existing result without mutation. Existing membership of any status blocks invitation. Full-replacement edits/reactivation use exact optimistic versions; deactivation preserves assignment configuration but immediately removes effective access. No automatic account creation or naive cross-email linking. | `ADR-014`, `ADR-021` |
| **OQ-007** | MVP forbids negative inventory for every stock-decreasing movement. Inside the same PostgreSQL transaction and authoritative branch/product balance serialization boundary, the service calculates `resultingQuantity = currentQuantity + signedDelta`; a result below zero returns `409 INSUFFICIENT_STOCK` with no ledger or balance mutation. No role has an override. Inventory uses immutable signed-delta ledger movements plus an atomically maintained lazy balance projection; manual adjustments use the accepted reason/note, idempotency, lifecycle, and permission rules in `ADR-024`. | `ADR-024` |
| **OQ-010** | Use Branch/Product moving weighted-average cost. Receipt `actualUnitCost` is authoritative intake; PO `expectedUnitCost` is planning/history only. The cost basis may be `UNKNOWN` for quantity created before an authoritative receipt; the first receipt initializes the cost basis for all then-on-hand quantity without reconstructing historical cost. Later cost-dependent facts use the current known average. FIFO, cost layers, zero-cost fabrication, and an Opening Cost/Recost workflow are out of MVP. | `ADR-026` |
| **OQ-013** | **DEFERRED FROM MVP.** Inter-branch stock transfer remains broader/full product scope, but no transfer schema, API, UI, permission, lifecycle, ledger-source, or idempotency contract is part of the current MVP. A previously discussed `SEND → IN_TRANSIT → RECEIVE → RECEIVED` direction with exact quantity and no partial/discrepancy workflow is non-binding future guidance only and must be re-reviewed before implementation resumes. | `ADR-025` |
| **OQ-021** | A PO is `DRAFT`, `ORDERED`, `RECEIVED`, or `CANCELLED`; only `DRAFT` is editable, and `ORDERED` freezes Supplier, Branch, Product lines, quantities, expected unit costs, and accepted commercial snapshots. One ordered PO produces at most one all-at-once immutable receipt whose quantities are server-derived from PO lines. Partial/over/short/multiple receipt, discrepancy, receiving without a PO, supplier return, receipt reversal, and receipt correction are out of MVP. | `ADR-026` |
| **OQ-022** | Use fixed, deny-by-default RBAC with one organization role per user/organization and explicit branch assignments for branch-only roles. `OWNER`/`ADMIN` are organization-wide; `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER` are assigned-branch roles. The role, governance, delegation, capability, analytics, forecast, and AI-summary baseline in section 8 is authoritative; refund/void remains `OQ-009`. | `ADR-016` |
| **OQ-014** | Branch-level price overrides are out of MVP scope. Each Product has one organization-level required non-negative `basePrice`; its API representation is a decimal string with scale at most 4 and its target persistence representation is `DECIMAL(19,4)`. Inputs with more than four fractional digits are rejected, never rounded. All branches use that base price for future operations, while future sale items snapshot the actual unit price used. Tax, discount, receipt-total, payment, currency, and sales-transaction rounding remain open in `OQ-008`. | `ADR-022` |
| **OQ-023** | Each Product has exactly one immutable base unit: `EA`, `PACK`, `BOX`, `KG`, `G`, `L`, `ML`, `M`, or `CM`. `EA`, `PACK`, and `BOX` are integer-only; the other units allow up to four fractional digits. Quantity APIs use decimal strings and persistence targets `DECIMAL(18,4)`; values with excess precision are rejected, never rounded. There is no unit conversion, pack-size conversion, or separate purchasing/selling UOM in MVP. Positive requested business-operation quantities must be greater than zero. `ADR-024` applies this boundary to signed inventory-ledger deltas and canonical inventory output. | `ADR-022`, `ADR-024` |
| **OQ-024** | Product display names are trimmed, nonblank, Unicode-preserving, and may duplicate within an organization. SKU is the required organization business identifier and is canonicalized by trim, Unicode NFKC, then uppercase; it must match `^[A-Z0-9][A-Z0-9._-]{0,63}$` and is unique per organization. Barcode is optional, trimmed with blank mapped to null, exact-match unique when non-null, control-character-free, and at most 128 characters. Categories are flat; their nullable product relation allows uncategorized products. Category identity is a per-organization unique NFKC/trim/collapsed-Unicode-whitespace/lowercase key while display names retain trimmed presentation. Product and Category use `ACTIVE`/`INACTIVE`, allow reactivation, prohibit hard-delete endpoints, and use exact `updatedAt` optimistic concurrency (`PRODUCT_STALE`/`CATEGORY_STALE`). Inactive categories remain referenced but cannot be newly assigned; no merge or bulk reassignment exists. | `ADR-022` |

### Open Questions

| ID | Question | Blocks | Priority |
| --- | --- | --- | --- |
| **OQ-008** | Which sales payment methods/states, Output VAT, discount ordering, tender/change, sales receipt-number/display rules, and sales monetary rounding are in the MVP? P4 accepts THB-only purchasing currency, `ROUND_HALF_UP` at required persisted/display scales, and document-level Input VAT receipt snapshots only. | POS/sales | Critical |
| **OQ-009** | What are the exact void, refund, partial-refund, time-limit, approval, and stock-reversal rules? | Sales reversal | Critical |
| **OQ-011** | Which exact analytics thresholds, comparison windows, inclusions/exclusions, and completed-sale state are accepted? | Analytics | Critical |
| **OQ-012** | What is Forecasting V1, including horizon, granularity, baseline algorithm, minimum data, cold-start behavior, seasonality, and evaluation metric? | Forecast and reorder | Critical |
| **OQ-015** | What are the exact production hosting topology, region, ingress, secret-management, IaC, availability, backup, and cost targets? | Cloud deployment | High |
| **OQ-016** | Does each organization choose a timezone, or is reporting fixed to `Asia/Bangkok`? How are DST and late transactions handled? | Database, analytics, schedules | High |
| **OQ-017** | At what local times do daily, weekly, monthly, and yearly jobs run, and how are retries/catch-up handled? | AI scheduler | Medium |
| **OQ-018** | Which OpenRouter model, fallback policy, timeout, budget, prompt review, and retention rules are accepted? | AI integration | Medium |
| **OQ-019** | Is a durable audit-log feature required in MVP or only production hardening? | Security/compliance | Medium |
| **OQ-020** | Beyond the accepted narrow process-local registration, login, verification-resend, and password-reset-request limiters, what distributed/IP-aware/global/provider-wide abuse controls, proxy trust, multi-instance coordination, production DoS controls, long-term abuse telemetry, measurable performance, availability, recovery, browser-support, and data-retention targets define production readiness? | Hardening/load tests | Medium |

## 17. MVP completion boundary

MVP is a feature checkpoint, not a synonym for localhost. It is complete only when the accepted core workflow runs end-to-end with appropriate tests:

```text
Register / Authenticate
        ↓
Organization
        ↓
Branch
        ↓
Product
        ↓
Supplier
        ↓
Purchase Order
        ↓
Receive Stock
        ↓
Inventory Updated
        ↓
POS Checkout
        ↓
Stock Deducted
        ↓
Sales History
        ↓
Dashboard Analytics
        ↓
Deterministic Forecasting V1
        ↓
Reorder Recommendation
        ↓
Scheduled AI Insight
```

MVP completion does not require AWS production deployment. It is the feature-complete application checkpoint reached when the accepted workflow above runs end-to-end with appropriate tests. Deterministic Forecasting V1, Reorder Recommendation, and Scheduled AI Insight are explicit MVP capabilities; they are not hidden inside a generic analytics checkpoint or deferred to cloud delivery. OpenRouter remains outside numerical analytics and forecasting and receives only precomputed aggregate analytics snapshots.

After the feature-complete MVP, the same codebase progresses through later delivery phases:

```text
Feature-complete MVP
        ↓
AWS Cloud Deployment
        ↓
Security / Performance / Observability Hardening
        ↓
Production-like System
```

AWS Cloud Deployment is therefore a later delivery phase, not a condition of MVP completion. Production hardening follows cloud deployment; the MVP is evolved rather than discarded or rebuilt.
