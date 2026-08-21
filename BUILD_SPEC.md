# StockWise Build Specification

| Field | Value |
| --- | --- |
| Product | **StockWise** |
| Full name | StockWise: Smart Inventory and Sales Analytics Platform for SMEs |
| Repository | `stockwise` pnpm workspace monorepo |
| Baseline | Architecture Freeze v1 |
| Status | Pre-implementation; accepted architecture frozen with explicit domain decision gates |
| Last updated | 2026-08-22 |

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

Stock transfer, branch price overrides, refunds/voids, and particular payment methods are neither silently included nor excluded; their MVP status is unresolved in the Open Questions register.

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

These five role names are the accepted MVP role baseline and must not be renamed casually. They do not define the complete authorization policy or authorize an action by themselves. `OQ-022` remains open for the exact organization-level and branch-level permissions, delegation, membership administration, product management, stock adjustment, purchasing/receiving, checkout, refund/void, cost/margin visibility, organization-wide analytics, and last-owner governance. Server-side policy must check organization membership, branch assignment, role, action, and resource ownership.

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

- Register and sign in with email and password.
- Hash passwords with Argon2; never store plaintext or reversible passwords.
- Complete the required user profile after registration.
- Create or join an organization according to the finalized onboarding flow.
- Create and manage branches with authorized roles.
- Assign users to organization and branch scopes.
- Switch active branch without signing in again.
- View an allowed organization-level aggregate when the role permits it.
- Sign out according to the selected token/session strategy.

Google login is a future feature. Email verification, token/session strategy, reset-password provider, onboarding fields, and invitation details are open questions.

### 10.2 Product catalog

- Manage organization-level categories and products.
- Store SKU, optional barcode, name, description, unit, product status, selling price, and the data needed by the selected costing model.
- Enforce organization-scoped SKU and barcode uniqueness rules.
- Search and filter products for management and POS use.
- Preserve past sale snapshots when current product details change.

Branch-level price overrides are an open question. Until decided, no endpoint or schema may imply support for them.

### 10.3 Branch inventory

- Read current product balances by branch.
- Record every stock change as an append-oriented inventory transaction.
- Maintain a query-efficient balance projection consistent with the ledger.
- Receive stock, sell stock, adjust stock, and record reversals when the relevant business rules allow them.
- Show inventory history and low-stock information.
- Prevent lost updates and overselling according to the selected negative-stock rule.

The negative-stock rule and stock-transfer MVP scope are open questions.

### 10.4 Suppliers and purchasing

- Manage organization-level suppliers.
- Create purchase orders for a target branch.
- Add purchase-order line items and follow a controlled status lifecycle.
- Receive goods into the target branch.
- Support an atomic receipt that creates receipt records, ledger entries, balance changes, and any cost changes required by the selected costing model.
- Preserve historical purchase and receipt values independently of current product values.

Partial receiving and costing details must be finalized before implementation of receiving logic.

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

- **FR-IAM-001:** The system shall authenticate MVP users with email and password.
- **FR-IAM-002:** The system shall store password verifiers created with Argon2.
- **FR-IAM-003:** The system shall authorize every business operation by organization membership, branch scope where applicable, and role permission.
- **FR-IAM-004:** One user shall be able to access multiple authorized branches using one account.
- **FR-IAM-005:** A user shall not access a tenant, branch, or aggregate outside their authorization scope.

### Catalog and inventory

- **FR-CAT-001:** Products and categories shall be scoped to one organization.
- **FR-CAT-002:** SKU and barcode constraints shall be enforced within the owning organization according to `docs/DATABASE.md`.
- **FR-INV-001:** Stock shall be represented by both a current balance and traceable inventory transactions.
- **FR-INV-002:** Every balance mutation shall have a corresponding ledger entry created atomically.
- **FR-INV-003:** Inventory shall be scoped to a branch.
- **FR-INV-004:** Concurrent mutations shall not lose updates or violate the finalized stock rule.

### Purchasing

- **FR-PUR-001:** Suppliers shall be scoped to an organization.
- **FR-PUR-002:** Purchase orders and receipts shall target a branch in the same organization.
- **FR-PUR-003:** Receiving shall atomically update receipt state, the inventory ledger, balances, and applicable cost data.

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
- Use Argon2 for password hashing and apply rate limiting and abuse protection to authentication endpoints.
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

1. This repository contains only the approved repository/tooling foundation and Source of Truth documentation; no application or infrastructure implementation exists yet.
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
| Authentication and authenticated state | `OQ-003` |
| Profile and organization/first-branch onboarding | `OQ-005` |
| Authorization policies for accepted MVP roles | `OQ-022` |
| Inventory mutations and stock availability | `OQ-007`, `OQ-023` |
| POS checkout and sales monetary truth | `OQ-007`, `OQ-008`, `OQ-010`, `OQ-022`, `OQ-023` |
| Refund and void | `OQ-009` plus the applicable sales decisions |
| Purchasing/receiving cost and quantity behavior | `OQ-007`, `OQ-010`, `OQ-023` |
| Analytics definitions | `OQ-011` |
| Forecasting V1 and reorder recommendation | `OQ-011`, `OQ-012` plus accepted costing/quantity inputs where used |

Other questions remain task-specific. In particular, exact AWS topology, scheduled-report times, OpenRouter model/fallback, audit-log hardening, and performance/recovery targets may remain open until their relevant phases; they do not block Repository Foundation or unrelated implementation.

## 16. Decision and Open Questions register

This is the canonical list. Other documents reference these IDs and must not redefine or answer them independently.

### Resolved decisions

| ID | Accepted answer | Decision record |
| --- | --- | --- |
| **OQ-001** | Use a native pnpm workspace on Node.js 24 LTS. Runtime applications use `apps/web` and `apps/api`; deliberately shared internal packages may use `packages/*` only when justified. Use one root lockfile and no monorepo orchestration framework until a measured need exists. | `ADR-011` |

### Open Questions

| ID | Question | Blocks | Priority |
| --- | --- | --- | --- |
| **OQ-002** | Will Next.js use the App Router, and what is the approved application route/layout convention? | Frontend bootstrap | Medium |
| **OQ-003** | What access-token/session and refresh/revocation strategy will be used, and where will browser credentials be stored? | Authentication/API security | Critical |
| **OQ-004** | Is email verification required, and which provider handles verification and password reset? | Authentication | High |
| **OQ-005** | What user profile and organization onboarding fields are required, and when is an account considered complete? | Onboarding/data model | High |
| **OQ-006** | What is the employee invitation and membership-acceptance flow? | User management | Medium |
| **OQ-007** | Is negative stock forbidden, allowed by permission, or allowed with warning? | Inventory, receiving, POS | Critical |
| **OQ-008** | Which payment methods, payment states, tax/VAT, discounts, and receipt-number rules are in the MVP? | POS/sales | Critical |
| **OQ-009** | What are the exact void, refund, partial-refund, time-limit, approval, and stock-reversal rules? | Sales reversal | Critical |
| **OQ-010** | Which inventory costing model is used in V1, including the treatment of purchase variances and returns? | Purchasing, margin analytics | Critical |
| **OQ-011** | Which exact analytics thresholds, comparison windows, inclusions/exclusions, and completed-sale state are accepted? | Analytics | Critical |
| **OQ-012** | What is Forecasting V1, including horizon, granularity, baseline algorithm, minimum data, cold-start behavior, seasonality, and evaluation metric? | Forecast and reorder | Critical |
| **OQ-013** | Is inter-branch stock transfer part of the MVP, and what is its in-transit lifecycle? | Inventory | High |
| **OQ-014** | Are branch-level price overrides part of the MVP? | Catalog/POS/data model | High |
| **OQ-015** | What are the exact production hosting topology, region, ingress, secret-management, IaC, availability, backup, and cost targets? | Cloud deployment | High |
| **OQ-016** | Does each organization choose a timezone, or is reporting fixed to `Asia/Bangkok`? How are DST and late transactions handled? | Database, analytics, schedules | High |
| **OQ-017** | At what local times do daily, weekly, monthly, and yearly jobs run, and how are retries/catch-up handled? | AI scheduler | Medium |
| **OQ-018** | Which OpenRouter model, fallback policy, timeout, budget, prompt review, and retention rules are accepted? | AI integration | Medium |
| **OQ-019** | Is a durable audit-log feature required in MVP or only production hardening? | Security/compliance | Medium |
| **OQ-020** | What measurable performance, availability, recovery, browser-support, and data-retention targets define production readiness? | Hardening/load tests | Medium |
| **OQ-021** | Does purchasing support partial receiving, over-receiving, cancellation after partial receipt, and supplier returns in MVP? | Purchasing/receiving | High |
| **OQ-022** | For the accepted MVP roles `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`, what are the exact organization/branch permissions, delegation and membership-administration rules, operational permissions, cost/margin visibility, organization-wide analytics access, and last-owner governance rules? | Authorization | Critical |
| **OQ-023** | Which units of measure are supported in MVP, may quantities be fractional, and what database/API precision and rounding apply to quantities? | Catalog, inventory, purchasing, sales, analytics | Critical |
| **OQ-024** | What normalization, duplicate-name, deactivation, and deletion rules apply to categories, suppliers, and other catalog master data? | Catalog and suppliers | Medium |

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
