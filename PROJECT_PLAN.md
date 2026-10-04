# StockWise Project Plan

| Field | Value |
| --- | --- |
| Project | StockWise |
| Plan baseline | Architecture Freeze v1 |
| Repository state | P7-M4 final post-remediation acceptance satisfied with explicit user-accepted L04 tooling-observation limitation; all eight findings VERIFIED FIXED, M11/P08 PASS, L04 BLOCKED; Phase6/Phase7 and Milestone7.4 COMPLETE; T01/T02 verified/accepted; historical T03 remains250 PASS/7 FAIL/3 BLOCKED and NOT ACCEPTED at its original checkpoint; PRE-CLOUD READY YES; Phase8 NOT STARTED; final acceptance documentation checkpoint |
| Last updated | 2026-10-04 |

## 1. Plan rules

Delivery hierarchy is `Phase -> Milestone -> Task`. Tasks are ordered by dependency and sized for one focused implementation/review cycle where practical.

Status notation:

- `[ ]` Not started
- `[x]` Completed and verified
- `Blocked: OQ-*` means the task remains unchecked and must not begin until those canonical questions in `BUILD_SPEC.md` are accepted.

Every task row includes:

- **Objective** — outcome to achieve
- **Scope** — bounded work included
- **Dependencies** — required prior tasks/decisions
- **Acceptance** — observable completion criteria
- **Testing** — minimum verification

Completing checks makes work ready for commit; it does not authorize a commit, push, PR, or other Git action. Follow `AGENTS.md`.

## Phase 0 — Product and architecture documentation freeze

### Milestone 0.1 — Source of Truth baseline

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P0-M1-T01 — Product contract** | Define product and master questions | `BUILD_SPEC.md` | Latest planning baseline | Goals, scope, requirements, non-goals, stack, OQ registry recorded | Manual requirement trace |
| [x] **P0-M1-T02 — Agent execution contract** | Govern future implementation | `AGENTS.md` | T01 | Stack, architecture/data/API/security/testing/Git/DoD rules recorded | Manual policy review |
| [x] **P0-M1-T03 — Architecture contract** | Define logical boundaries/flows | `docs/ARCHITECTURE.md` | T01 | Modular monolith, tenancy, flows, cloud/AI boundaries recorded | Diagram/link review |
| [x] **P0-M1-T04 — Database contract** | Define logical data/invariants | `docs/DATABASE.md` | T01, T03 | Entities, constraints, indexes, lifecycles, transactions recorded | Entity/OQ trace review |
| [x] **P0-M1-T05 — Analytics contract** | Centralize metric/formula definitions | `docs/ANALYTICS.md` | T01, T03, T04 | Metrics have one definition/status; forecast/AI snapshot boundary recorded | Formula/OQ review |
| [x] **P0-M1-T06 — Behavior contract** | Define use cases and failure paths | `USE_CASE_SPECS.md` | T01, T03–T05 | Core actors, flows, alternatives, errors, auth, acceptance recorded | Requirement/use-case trace |
| [x] **P0-M1-T07 — API contract** | Define planned REST surface | `docs/API.md` | T01, T03–T06 | Versioning, envelopes, resources, auth/validation/errors/blockers recorded | Endpoint/use-case trace |
| [x] **P0-M1-T08 — Delivery plan** | Order bounded implementation tasks | `PROJECT_PLAN.md` | T01–T07 | Phase/milestone/task dependency chain recorded | Dependency review |
| [x] **P0-M1-T09 — Architecture decisions** | Preserve accepted rationale | `docs/DECISIONS.md` | T01, T03–T05 | Required ADRs and consequences recorded | ADR/current-doc review |
| [x] **P0-M1-T10 — Cross-document consistency audit** | Leave one coherent Source of Truth | All nine documents, links, IDs, decision statuses | T01–T09 | No conflicting stack/scope/ownership/formula/API statements; all OQ references exist | Automated text/ID/fence/legacy-direction/capability scans + manual trace revalidated 2026-08-22 |

### Milestone 0.2 — Critical Decision Gate

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P0-M2-T01 — Register decision gates** | Prevent unresolved choices from leaking into code | Map `OQ-001`–`OQ-024` to affected tasks/contracts | P0-M1-T10 | Every referenced OQ has one canonical definition and implementation blockers are explicit | Definition/reference scan completed |
| [x] **P0-M2-T02 — Establish change protocol** | Prevent silent requirement drift | Record OQ/ADR/affected-document/plan update workflow | P0-M1-T10 | Future decisions have one owner and update path; implementers must stop at product/architecture ambiguity | Manual workflow trace completed |
| [x] **P0-M2-T03 — Identity/onboarding/authorization gate** | Finalize rules before identity-domain implementation | Recorded accepted `OQ-003`–`OQ-006` and `OQ-022` rules for sessions, email lifecycle, onboarding, invitations, and fixed RBAC | Before affected Phase 2 implementation | Decisions accepted; build/data/API/use cases/ADR and permission matrix updated consistently | Cross-document trace plus session/token, invitation, delegation, escalation, and last-owner decision-boundary review completed 2026-08-22 |
| [x] **P0-M2-T04 — Inventory/purchasing/sales gate** | Finalize stock, money, and cost rules before affected operations | `OQ-007` is resolved by `ADR-024`, `OQ-010`/`OQ-021` by `ADR-026`, sales-side `OQ-008` by `ADR-027`, refund behavior `OQ-009` by `ADR-028`, and `OQ-023` by `ADR-022` | Before affected inventory, purchasing, sales, and refund implementation | Worked examples and affected contracts agree; VOID is excluded and REFUND is implementation-ready | Stock, decimal, costing, checkout, receiving, and 12 refund boundary scenarios reviewed 2026-09-19 |
| [ ] **P0-M2-T05 — Analytics/forecast gate** | Finalize numerical truth before affected analytics/forecast implementation | `OQ-011` resolved by `ADR-029`; `ADR-030` accepts fixed P6-M3-T02 coverage classification; `ADR-031` resolves `OQ-012` for Forecasting V1; `ADR-032` accepts Reorder V1 policy; stockout risk still needs a separate rule, preserving TypeScript/SQL and summary-only LLM | Before each affected Phase 6 implementation | Every implemented metric/forecast/reorder rule has one accepted definition/version | Analytics fixtures/time-boundary review completed 2026-09-20; forecast backtest design/leakage review completed 2026-09-24; Reorder V1 policy accepted 2026-09-25, stockout-risk decision remains |

The unchecked decision-gate tasks do **not** block Phase 1 repository/tooling, application shells, or unrelated work. Each gate blocks only the affected business-domain implementation. `OQ-017`/`OQ-018` are resolved by `ADR-033`; `OQ-015`, `OQ-019`, and `OQ-020` remain open for their relevant phases.

## Phase 1 — Repository foundation

### Milestone 1.1 — Repository Foundation & Tooling

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P1-M1-T01 — Repository Foundation & Tooling** | Establish the approved workspace/package-manager root | Inspect the documentation-only starting state; resolve `OQ-001`; add only the approved root workspace/package-manager files, lockfile, repository conventions, and ignore policy; update verified workspace/install commands in `AGENTS.md` | P0-M1-T10; `OQ-001` owner-approved 2026-08-22 | One minimal `stockwise` pnpm workspace root; frozen install and workspace discovery verified; no application, TypeScript quality stack, tests, environment contract, database, domain, or cloud implementation | pnpm 11.19.0 frozen install, stale-lock rejection, workspace discovery, manifest/ignore/repository-scope review passed |
| [x] **P1-M1-T02 — TypeScript and code-quality baseline** | Establish strict compile/lint/format policy | Shared strict TypeScript baseline, linting, formatting, and exact root quality scripts; no application shell | T01 | Configurations are minimal/non-overlapping; lint/format/typecheck commands are documented and pass for applicable files | Config validation, lint, format-check, typecheck |
| [x] **P1-M1-T03 — Test baseline and root test scripts** | Provide a verified non-domain test foundation | Approved test runner, minimal smoke test/config, root test scripts and conventions; no business tests or app initialization | T01, T02 | Test command passes and demonstrates discovery/failure behavior without domain code | Passing smoke test plus intentional failure/discovery verification |
| [x] **P1-M1-T04 — Environment example and validation contract** | Define secret-safe configuration ownership | `.env.example`, variable categories/ownership, safe local/test guidance; per-process Zod validation is added when each process shell exists | T01 | No secrets; client/server exposure boundaries documented; no speculative provider/cloud variables | Secret scan, ignore-policy verification, documentation review, frozen install, format-check, lint, typecheck, and tests passed 2026-08-22; process-schema tests remain assigned to the owning shell tasks |
| [x] **P1-M1-T05 — CI quality gates** | Reproduce verified local quality checks in CI | GitHub Actions for frozen install, lint, format-check, typecheck, and tests; add builds only after app shells exist | T02–T04 | Minimal least-privilege workflow uses the same root commands and no secrets | Workflow YAML parsing, immutable action-pin resolution, permissions/scope review, frozen install, format-check, lint, typecheck, and tests passed 2026-08-22 |

### Milestone 1.2 — Application shells

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P1-M2-T01 — Next.js web shell** | Bootstrap responsive frontend | Approved Next.js routing, TypeScript, Tailwind, shadcn/ui baseline, TanStack Query provider, accessible shell, web-owned Zod environment boundary | P1-M1-T01–T04, `OQ-002` resolved by `ADR-012` | Web dev/build starts; responsive navigation shell; no product features or PWA/offline requirement | Frozen install, workspace discovery, format-check, lint, strict typecheck/type generation, root and web tests, build, dev/start HTTP smoke, dependency/route/RSC/diff review passed 2026-08-22 |
| [x] **P1-M2-T02 — Express API shell** | Bootstrap backend modular boundary | Express app factory/server entry, middleware order, `/api/v1`, safe error envelope, structured request ID/logging, API-owned Zod environment boundary | P1-M1-T01–T04 | App starts/stops cleanly; no domain logic; safe 404/error/config behavior | Frozen install, workspace discovery, format-check, lint, strict typecheck, 15 root tests/11 API tests, API/web builds, dev/start and signal-shutdown smoke, dependency/audit/environment/error/diff review passed 2026-08-22 |
| [x] **P1-M2-T03 — Health/readiness** | Provide deployment probes | `/health`, `/ready`, dependency-safe status semantics | T02 | No secrets/details; readiness changes with required dependency | Frozen install, format-check, lint, strict typecheck, 18 root tests/14 API tests, API/web builds, compiled API HTTP smoke, and dependency/safe-output/diff review passed 2026-08-22 |
| [x] **P1-M2-T04 — Web-to-API development path** | Validate local integration | Same-origin `/api/health` rewrite to loopback Express `/health`, typed health client/view, strict web/API configuration | Web/API shells | Browser reaches API without disabling security broadly; business APIs remain Express-owned | Frozen install, format-check, lint, strict typecheck, 24 tests, build, dev/start HTTP proxy smoke, direct-origin/CORS-header check, and desktop-browser 375px responsive smoke passed 2026-08-22 |

### Milestone 1.3 — Local data foundation

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P1-M3-T01 — Local PostgreSQL and Docker setup** | Provide reproducible disposable development database | Docker configuration, healthcheck, volumes, safe local credentials/examples | P1-M1-T01, P1-M1-T04 | Documented start/stop; no production credentials; data target explicit | Compose validation, clean-start health, loopback/connectivity, restart persistence, and non-destructive teardown passed 2026-08-22 |
| [x] **P1-M3-T02 — Prisma foundation** | Establish safe schema/migration workflow | Initialize Prisma for PostgreSQL, generated client location, empty/foundation migration policy, scripts | P1-M1-T02, T01 | Prisma client generation, validation, disposable migration no-op, and PostgreSQL smoke passed; `docs/DATABASE.md` records the no-model foundation convention | Generate/validate/migrate and `SELECT 1` on disposable DB passed 2026-08-22 |
| [x] **P1-M3-T03 — Database test harness** | Enable real integration/concurrency tests | Isolated test database/schema, reset strategy restricted to disposable target, transaction helpers | T01, T02 | Repeatable parallel-safe test setup; production URL guard | Repeated PostgreSQL/Prisma smoke, target-safety, cleanup, rollback, full quality/build/audit checks, and temporary-environment cleanup passed 2026-08-22 |

## Phase 2 — Identity, organizations, and branches

### Milestone 2.1 — Identity decision gate and schema

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P2-M1-T01 — Close identity/onboarding decisions** | Unblock identity implementation | Accepted session, email lifecycle, onboarding, invitation, and RBAC decisions; permission matrix and decision-boundary review | Phase 1 | Accepted decisions update build/data/API/use cases/ADR | Cross-document trace plus session/token, invitation, delegation, escalation, and last-owner decision-boundary review completed 2026-08-22 |
| [x] **P2-M1-T02 — Identity and tenancy schema** | Persist users, organizations, branches, memberships | Prisma models/constraints/indexes/forward migrations for accepted fields only, including the nullable-display-name correction | T01, P1-M3 | Same-tenant relationships, multi-branch users, preserved actor history; registration-stage display name may be null while present values remain nonblank | Initial validation passed 2026-08-22; incremental existing-row and clean two-migration chains, 13 schema tests, full 174-test suite, harness, quality/build/audit/diff review passed 2026-08-24 |
| [x] **P2-M1-T03 — Authorization policy foundation** | Centralize RBAC + branch scope | Typed permission vocabulary, trusted request context, policy tests; no endpoint wiring | T01, T02 | Organization/branch decisions evaluated in one policy layer | 132 focused policy tests plus full 173-test suite, database harness, format-check, lint, strict typecheck, builds, production audit, and diff review passed 2026-08-24 |

### Milestone 2.2 — Authentication

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P2-M2-T01 — Registration and Argon2** | Create secure email/password accounts | Email/password-only validation; canonical normalization; accepted Argon2id hashing; generic `202` new/duplicate response; five-per-15-minute canonical-email process-local limiter; persist unverified user only | P2-M1, P1-M2-T02 | No plaintext exposure; `displayName`/`emailVerifiedAt` remain null; no token, email, session, organization, or branch creation; accepted verification next step | 163 focused identity/registration tests, 205 full tests, 4 harness tests, frozen install, format/lint/typecheck/build, production audit, and diff review passed 2026-08-24 against isolated PostgreSQL 16.11 |
| [x] **P2-M2-T02 — Login and authenticated context** | Establish accepted auth state | Strict credential validation; centralized real/dummy Argon2 verification; five-failure fixed-window login limiter; fresh opaque hash-only session creation and atomic same-user rotation; secure cookie; sliding idle/fixed absolute expiry; trusted actor/session middleware context only | T01 | Protected request resolves active verified actor safely without client-controlled authorization state; login returns only safe actor fields | 56 focused login/auth/session tests, 262 full tests, 4 harness tests, frozen install, format/lint/typecheck/build, production audit, STRIDE/leakage review, and diff checks passed 2026-08-24 against isolated PostgreSQL 16.11 |
| [x] **P2-M2-T03 — Logout, verification, and credential recovery** | End/verify/recover access safely | Current/all-session logout; verification-token creation/resend/consumption; provider-abstracted Resend/non-delivery integration; password reset; narrow three-per-15-minute resend/reset-request limiters | T02 | Hash-only 24-hour/30-minute token lifecycle, provider compensation, account-safe responses, pre-Argon2 rejection, and atomic password/session revocation match accepted decisions | 298 full tests and 4 harness tests, including replay/expiry/replacement/provider/limiter/concurrency/rollback/revocation/leakage coverage; frozen install, format/lint/typecheck/build, production audit, STRIDE/secret/diff review passed 2026-08-24 against isolated PostgreSQL 16.11 |
| [x] **P2-M2-T04 — Authentication UI** | Provide accessible auth flows | Registration/login/logout/verification/reset states only as accepted | T01–T03, web shell | Responsive, accessible, safe error UI | 24 focused web tests; 314 full tests; 4 database-harness tests; frozen install, format/lint/typecheck/build, production audit, and diff review passed 2026-08-24 against isolated PostgreSQL 16.11 |

### Milestone 2.3 — Onboarding and access management

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P2-M3-T01 — Profile and first organization onboarding** | Establish first usable tenant/branch | Required display name, organization, first branch, OWNER role; optional phone/address; idempotent atomic flow | P2-M2 | No partial/duplicate onboarding | 29 focused API/DB normalization, auth, eligibility, replay, rollback, concurrency, and tenant-invariant tests; 30 focused web tests; 336 full tests; 4 harness tests; existing/clean migration and zero-drift checks; full quality/build/audit/diff review passed 2026-08-24 |
| [x] **P2-M3-T02 — Branch management and switcher** | Support multiple branches per user | Policy-authorized create/list/edit/activate/deactivate; effective access context; URL-owned frontend context switch/cache invalidation | T01, authorization policy | Server revalidates every branch; no stale cross-branch UI | 32 focused branch schema/router/PostgreSQL/HTTP/frontend tests; 367 full tests; 4 harness tests; frozen install, Prisma validate/generate, format-check, lint, strict typecheck, build, production audit, and diff/security review passed 2026-08-24 |
| [x] **P2-M3-T03 — Membership invitation/assignment** | Manage staff scope | Email-bound hash-only invite, role, branch assignment, deactivate flow | P2-M2 | No privilege delegation/escalation violation | 40 focused schema/router/PostgreSQL/frontend tests; 393 full tests; 4 harness tests; frozen install, clean/existing migration paths, zero drift, format/lint/typecheck/build, production audit, and security/diff review passed 2026-08-24 |

## Phase 3 — Products and inventory

### Milestone 3.1 — Catalog decision gate and models

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P3-M1-T01 — Close catalog/quantity decisions** | Unblock catalog and inventory representation | Accepted `OQ-014`, `OQ-023`, and `OQ-024`: organization base price only, unit/quantity precision, and catalog normalization/lifecycle | Phase 2 foundation | `ADR-022` and affected build/API/data/use-case/architecture documents record accepted boundaries; at this historical gate, `OQ-008`, `OQ-010`, and `OQ-011` were outside scope (`OQ-010` is now resolved by `ADR-026`) | Cross-document, decimal/unit/lifecycle, and plan-dependency review completed 2026-08-25 |
| [x] **P3-M1-T02 — Category and product schema** | Persist organization catalog safely | Models, uniqueness, statuses, same-tenant category relation, organization-level `basePrice`, accepted units, and migration; no cost/valuation field or branch-price model | T01 | SKU/barcode tenant constraints; no branch stock, cost/valuation, or branch-price field | 15 focused normalization/schema/duplicate/concurrency/cross-tenant tests; 408 full tests; 4 harness tests; clean and pre-T02 forward migration, preserved-row, live zero-drift, frozen-install, format/lint/typecheck/build/audit/diff/security reviews passed 2026-08-25 |
| [x] **P3-M1-T03 — Catalog API** | Manage/search catalog | Category/product list/create/read/update/deactivate, cursor search, Zod | T02, authorization | Historical references preserved; safe errors | 36 focused catalog value/schema/router/PostgreSQL authorization, tenant, lifecycle, cursor, duplicate, stale, decimal/unit, and concurrency tests; 429 full tests; 4 harness tests; frozen install, Prisma validate/generate, format/lint/typecheck/build, production audit, and security/diff review passed 2026-08-25 |
| [x] **P3-M1-T04 — Catalog UI** | Provide responsive catalog management | `/app/catalog` Products/Categories views; same-origin typed client; URL/access-context-scoped cache; role-aware create/edit/lifecycle UX; search/filter/keyset load-more; safe stale/conflict/error states | T03 | Accessible PC/tablet/phone catalog management; no stock, cost, valuation, supplier, or branch-price behavior | 10 focused catalog web/client tests plus cache-isolation coverage; 3 real Chromium Next.js → Express → PostgreSQL E2E scenarios; axe desktop/category/mobile scans; frozen install, format/lint/typecheck, 439 full tests, 4 harness tests, build, production audit, and diff check passed 2026-08-26 |

### Milestone 3.2 — Inventory decision gate and ledger

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P3-M2-T01 — Close negative-stock/adjustment decisions** | Define balance invariant and permissions | Resolved `OQ-007`; accepted signed delta, lazy balance, reasons/notes, permission-only approval, idempotency, pessimistic balance serialization, lifecycle, and bounded `OQ-019` provenance | P3-M1, P2 policy | `ADR-024` plus data/API/use-case/architecture contracts agree; generic `OQ-019` remains open | Negative/zero/concurrent/lazy/idempotency/correction/inactive-resource scenarios and policy permission review completed 2026-08-27 |
| [x] **P3-M2-T02 — Balance and ledger schema** | Store branch stock traceably | Inventory balance/transaction, source uniqueness, indexes, migration | T01 | Unique branch/product balance; append ledger; same-tenant invariant | 10 focused inventory schema tests; 34 affected schema/integration tests; 455 full tests; guarded migration deploy, format/lint/typecheck/build, and diff review passed 2026-08-30 |
| [x] **P3-M2-T03 — Inventory query/history API** | Read balances and ledger | Paginated inventory/history, stable filters/scope | T02 | Accurate isolated balance/history | 17 focused inventory API tests; 462 full tests; format/lint/typecheck/build/diff review passed 2026-08-30 |
| [x] **P3-M2-T04 — Atomic adjustment service/API** | Safely change stock by delta | Idempotency, locking/version strategy, ledger+balance transaction | T01–T03 | No lost update/double adjust; accepted stock rule | 43 focused T04 tests; 55 inventory tests; 500 full tests; format/lint/typecheck/build/diff review passed 2026-08-30 |
| [x] **P3-M2-T05 — Inventory UI** | Operate/read branch stock | Balance/history/adjustment UI, reason/permission/error states | T03–T04 | Responsive and accessible; no direct balance edit illusion | 24 focused frontend/client tests; 6 Chromium E2E tests including axe desktop/mobile; format/lint/typecheck/test/build/diff review passed 2026-08-31 |

### Milestone 3.3 — Optional branch transfer gate

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P3-M3-T01 — Decide stock-transfer MVP** | Include or defer explicitly | Resolved `OQ-013` as **DEFERRED FROM MVP**; transfer remains broader/full future scope and no lifecycle contract is frozen | P3-M2 | `ADR-025` and affected contracts/plan synchronized; no ambiguous movement pair | Lifecycle/concurrency/dual-branch decision review completed 2026-08-31 |
| [ ] **P3-M3-T02 — Implement transfer lifecycle if accepted (deferred)** | Trace stock between branches | Not started; skipped while stock transfer is deferred from MVP | T01, future explicit re-approval | No implementation until the deferred feature is resumed and its contract is re-reviewed | Not applicable while deferred |

## Phase 4 — Suppliers and purchasing

### Milestone 4.1 — Purchasing decision gate and supplier

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P4-M1-T01 — Close costing and receiving decisions** | Unblock historical cost and receipt lifecycle | Resolved `OQ-010`/`OQ-021`: exact one-shot receipt, no returns/reversal, Branch/Product moving weighted average, THB, rounding, and bounded Input VAT snapshots | Phase 3 | `ADR-026` and affected contracts updated; sales-side `OQ-008` was outside this historical gate and is now resolved by `ADR-027` | Worked examples, state-transition, uncosted-basis, atomicity, and concurrency review completed 2026-08-31 |
| [x] **P4-M1-T02 — Supplier model/API/UI** | Manage organization suppliers | Organization-scoped Supplier schema/migration, CRUD/lifecycle API, and responsive `/app/suppliers` UI; no PO/receiving/costing scope | Phase 2, P3-M1-T01, T01 | Server-derived tenant/role scope; immutable history-safe lifecycle; committed and history-safe deactivate | 530 Vitest tests across 67 files; 8 Chromium E2E scenarios including Supplier desktop/mobile axe coverage |

### Milestone 4.2 — Purchase orders

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P4-M2-T01 — Purchase order schema/lifecycle** | Persist branch-targeted orders and snapshots | Order/items, accepted states, totals/cost, constraints/indexes/migration | P4-M1 | Same-tenant supplier/products/branch; immutable non-editable states | Migration, state, decimal, FK tests |
| [x] **P4-M2-T02 — Purchase order API** | Create/edit/list/read accepted lifecycle | Zod, authorization, pagination, concurrency/version checks | T01 | No stock change before receipt; stable errors | API/security/state/duplicate/stale tests including real PostgreSQL lifecycle races |
| [x] **P4-M2-T03 — Purchase order UI** | Operate orders responsively | List/detail/editor/status/validation/error states | T02 | Historical snapshots shown; disabled invalid actions | Component/integration/E2E/accessibility |

### Milestone 4.3 — Atomic receiving

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P4-M3-T01 — Receipt schema and receiving service** | Receive into stock exactly once | Receipt/items, PO protection, cost update, ledger/balance, idempotency | P4-M2, inventory service | Receipt/order/cost/ledger/balance commit together | Failure injection, concurrency, idempotency, reconciliation |
| [x] **P4-M3-T02 — Receiving API** | Expose atomic receive command | Validated quantities/cost, role/scope, response/error contract | T01 | No partial API workflow; safe retry | 38 focused receiving tests; 592 full tests across 78 files; 11 Chromium E2E scenarios; format, lint, strict typecheck, build, and diff check |
| [x] **P4-M3-T03 — Receiving UI** | Guide receipt entry and outcomes | Remaining quantities, actual cost, conflicts, retry-safe status | T02 | UI prevents obvious invalid input; server remains authority | 22 focused Receiving tests; 609 full tests; format, lint, strict typecheck, build, 12 Chromium E2E scenarios with accessibility coverage, and diff check; committed as `bdd5246aec1534f3fe2b74ca0f1b1dfe538ebe1a` |

## Phase 5 — POS and sales

### Milestone 5.1 — Sales decision gate and model

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P5-M1-T01 — Close payment/tax/discount/receipt decisions** | Define checkout monetary contract | Resolved `OQ-008`: transient cart, CASH/TRANSFER, THB, authoritative price/VAT, whole-Sale discount, Sale-backed receipt, exact allocation, atomic stock/cost/idempotency | Phase 4 | `ADR-027` and affected Source of Truth agree; no Sale status is frozen; `OQ-009` remains separate | Decimal/rounding/payment/VAT/UNKNOWN-cost scenario review completed 2026-09-05 |
| [x] **P5-M1-T02 — Sale/payment schema** | Persist immutable sales truth | Bounded Organization sales-VAT fields plus completed-by-existence Sale/items/one Payment, discount/VAT/cost snapshots, idempotency, Sale/inventory provenance, constraints/indexes, and migration; no Sale status, service, endpoint, or UI | T01 | Historical snapshots; branch/actor; one Payment; exact nullability/Decimal/allocation constraints; no deletions | 14 focused Sales schema tests; 47 focused cross-domain schema tests; 516 API tests; 623 repository tests; migration status and zero schema diff verified 2026-09-05 |

### Milestone 5.2 — Atomic checkout

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P5-M2-T01 — Server checkout service** | Commit sale/payment/stock atomically | Reload product/price, totals, lock order, stock policy, idempotency, transaction | P5-M1, inventory | Exactly one consistent sale or rollback; no provider dependency | Failure injection, oversell concurrency, deadlock/idempotency, decimal tests |
| [x] **P5-M2-T02 — POS product search and checkout API** | Expose safe POS operations | Organization sales-VAT profile read/update, sellable search/barcode, and `POST sales`; validation/auth/error mapping | T01 | Client totals/VAT ignored; exact replay; safe scoped responses; no COGS in customer receipt | API/security/price-change/stock/payment/VAT tests |
| [x] **P5-M2-T03 — Responsive POS UI** | Provide touch-friendly cart/checkout | Owner/admin VAT configuration and checkout-blocked UX; search/barcode input, transient cart, authorized discount, server reconciliation, payment/error/success states | T02 | Usable PC/tablet/phone; role-safe controls; duplicate submit protected | Component/integration/E2E/accessibility/responsive |

### Milestone 5.3 — History and receipts

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P5-M3-T01 — Sales history/detail API** | Read stable branch history | Pagination/filter/detail and Sale-backed receipt data; field-level cost permission; no initial status filter | P5-M2, permission matrix | Uses snapshots; no cross-branch leak; customer receipt omits COGS | API/security/pagination/catalog-change tests |
| [x] **P5-M3-T02 — Sales history and browser receipt UI** | Review and print sales | List/detail/filter/print, empty/error/loading states | T01 | Responsive printable receipt with accepted numbering | 145 focused web tests, 16 Chromium E2E scenarios, 727 serialized full tests, format, lint, typecheck, build, and diff check; committed as `47a2e7439753deb77814f76d553fd00b443e138c` |

### Milestone 5.4 — Reversal gate

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P5-M4-T01 — Decide refund/void rules** | Define reversal lifecycle | Resolved `OQ-009` with immutable linked REFUND records, partial quantities, optional per-item restock, payment, cost, authorization, idempotency, concurrency, and history rules; VOID excluded from V1 | P5-M2 | `ADR-028` and data/use case/API/analytics contracts agree; no runtime implementation | 12 exact state/money/stock/cost/concurrency/idempotency examples plus cross-document scrutiny completed 2026-09-19 |
| [x] **P5-M4-T02 — Implement reversal if in MVP** | Create traceable compensating workflow | Implemented bounded SaleRefund/SaleRefundItem/RefundPayment persistence, atomic service, API, history projection, and UI from `ADR-028`; no VOID | T01, `ADR-028` | Original history immutable; cumulative money/quantity, optional restock, cost, and payment remain consistent | 803 serialized tests across 90 files, including refund failure/concurrency/idempotency/permission coverage; 16 Chromium E2E scenarios; format, lint, typecheck, build, and diff checks passed 2026-09-19 |

## Phase 6 — Analytics and forecasting

Phase 6 — Analytics and forecasting is COMPLETE. Milestone 6.5 is COMPLETE, and
all tasks in Milestones 6.1–6.5 are complete. `STOCKOUT_RISK` remains
deferred/unassigned; Phase 6 completion
does not resolve or assign that separate rule. Phase 7 is COMPLETE under
`ADR-033`; Milestones 7.1, 7.2, and 7.3 are COMPLETE. P7-M3-T01, P7-M3-T02,
and P7-M3-T03 are COMPLETE. Milestone 7.4 is COMPLETE: T01/T02 accepted;
post-remediation T03 acceptance satisfied with the explicit user-accepted L04
tooling-observation limitation. MT-L04 remains BLOCKED. PRE-CLOUD READY YES;
Phase8 NOT STARTED. See docs/P7-M4-ACCEPTANCE.md.

### Milestone 6.1 — Definitions and period engine

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P6-M1-T01 — Close metric/timezone decisions** | Make analytics executable | Resolved `OQ-011`, `OQ-016`; event eligibility, Organization IANA time, periods, comparisons, explicit accepted/deferred thresholds, exact decimal/null/cost rules | Stable sales/inventory | `ADR-029` and `docs/ANALYTICS.md` accept/defer every metric without runtime work | 14 hand-calculated Sale/refund/cost/time-boundary examples plus cross-document scrutiny completed 2026-09-20 |
| [x] **P6-M1-T02 — Period and scope engine** | Canonicalize time/authorized aggregation | Implemented Organization reporting-time persistence, strict period selectors/boundaries, authorized Branch-set resolution, one source cutoff, and completeness metadata | T01 | Half-open windows; no unauthorized branch; reproducible context | IANA/timezone/DST/calendar/boundary/schema/backfill/onboarding/security tests completed 2026-09-20 |

### Milestone 6.2 — Deterministic sales analytics

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P6-M2-T01 — Base sales metrics** | Compute accepted totals/count/AOV/growth | Implemented set-based PostgreSQL/TypeScript Sales, discount, VAT, refund, count, AOV, growth, and cost/profit definitions with `analytics-v1` metadata | P6-M1 | Exact fixture agreement; decimal/null semantics | Unit + DB integration + zero/partial/scope/cutoff/timezone tests completed 2026-09-20 |
| [x] **P6-M2-T02 — Category and branch analytics** | Compare authorized dimensions | Implemented internal cursor-paged current-category money/share series and complete P6-M2-T01 Branch comparison series; no ranking/Top-N | T01 | Same period/definition; included branch scope disclosed; Category/Branch reconciliation | Multi-branch/category/history-change/security/reconciliation/pagination tests completed |
| [x] **P6-M2-T03 — Sales analytics API/UI** | Deliver accessible views | Implemented Sales, Category, and Branch HTTP/API exposure plus TanStack Query, Recharts, and accessible text/table UI | T01–T02 | No formula duplicated in UI; responsive accessible display | API integration/security/empty, UI/cursor/error, Chromium E2E/accessibility/tablet, and full-suite tests completed 2026-09-23 |

P6-M2-T03 dependency note: `recharts@3.6.0` is the accepted chart baseline for the
client-only Net Sales trend; a native SVG chart would duplicate responsive axis,
tooltip, and keyboard behavior. It is MIT licensed, pinned in the lockfile, and
adds 20 resolved packages. The 2026-09-23 production dependency audit reports no
Recharts advisory; its 11 reported advisories concern existing Next.js/Sharp and
other unrelated transitive dependencies. Exact financial values remain in the
accessible table rather than relying on chart coordinates.

### Milestone 6.3 — Inventory analytics

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P6-M3-T01 — Movement and coverage metrics** | Compute accepted factual inventory analytics internally | Paginated Branch/Product movement series; requested-period ADS; 28-complete-day coverage velocity and coverage; current on-hand/value snapshots and Branch availability summaries under `docs/ANALYTICS.md`. No fast/slow classification is currently accepted. | P6-M1, inventory/sales | Explicit zero/insufficient/integrity states, unit-safe quantities, and separate event/current-snapshot capture metadata | Fixed data, zero demand, 28-day eligibility, cutoff/pagination, negative-stock reconciliation anomaly, branch and cost-authorization tests; implemented by `c74bc098` |
| [x] **P6-M3-T02 — Stock risk analytics** | Classify page-current Branch/Product stock coverage internally | Compose fixed `stock-risk-v1` `LOW_STOCK`/`NORMAL`/`OVERSTOCK` classification onto each T01 dimension from its `coverageDays` only; null with an explicit reason when unavailable or Product inactive. No forecast, `STOCKOUT_RISK`, fast/slow, reorder, ranking, Top-N, LLM, or API/UI; Forecasting V1 was decided later by `ADR-031`. | T01; `ADR-030` fixed threshold decision | Explainable existing coverage input/status and version; exact accepted boundaries, no arbitrary or configurable thresholds | Decimal 0.00/7.00/just-above-7/just-below-60/60.00/above-60, null-reason, inactive-Product, authorization, and no-ranking/forecast fixtures; implemented by `f25adbf5` |
| [x] **P6-M3-T03 — Inventory analytics API/UI** | Expose accepted inventory analytics | HTTP/UI exposure of T01 factual results and T02 accepted per-dimension coverage classification only; no API/UI work in T01 or T02 | T01–T02 | Accessible, scoped, versioned outputs; no risk ranking/Top-N | API/UI/E2E/security/empty tests; complete in `1043c58c` (`feat: expose inventory analytics`) |

### Milestone 6.4 — Forecast and replenishment

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P6-M4-T01 — Close Forecasting V1** | Define one testable baseline/candidate | Resolved `OQ-012` for observed Sale quantity at Branch/Product grain, seven local days, prior 28 complete days, `forecast-sale-mean-28d-v1`, explicit cold start and MAE evaluation; excludes replenishment policy | P6-M1 | `docs/ANALYTICS.md`/`ADR-031`/plan aligned; no Python service or runtime | Four-window rolling-origin backtest design and leakage review completed 2026-09-24 |
| [x] **P6-M4-T02 — Forecast implementation** | Produce versioned deterministic forecasts | TypeScript/SQL algorithm, data status, reproducible inputs under `ADR-031` | T01 | Repeatable output and named `last-day-naive` MAE comparison | Implemented in `68a3e995696924d35afdabf7c8e27dcc098101e0`; focused 21/21, analytics/authorization 178/178; full suite 965/965 across 111 files before final test-only fixture correction, affected tests passed after correction; lint/typecheck/build/Prettier/diff check passed |
| [x] **P6-M4-T03 — Reorder recommendation** | Turn accepted inputs into guidance | Implemented internal advisory `reorder-v1` under accepted `ADR-032`; one Branch/Product result, no auto-order or API/UI exposure | T02, P4 decisions, `ADR-032` | Explainable recommendation; never auto-order | Implemented in `977f33f0588fc42547a60fc6a17f28fea131cdc5`; full suite 995/995 across 112 files, closure 35/35 across 2 files, lint/typecheck/build/targeted Prettier/diff check passed |
| [x] **P6-M4-T04 — Forecast/reorder API/UI** | Present estimates and limitations | Forecast/Reorder endpoints and `/app/analytics` view over T02–T03; version/data status/limitations; `FORECAST_REORDER_VIEW`; no LLM numbers, purchasing action, Supplier/MOQ behavior, or `STOCKOUT_RISK` | T02–T03 | No LLM numbers; accessible uncertainty/insufficient state | Implemented in `89c5d722a0088e9fb930082bd423ebdb1adc455f`; API/analytics/UI 66/66, web closure 25/25, E2E 2/2, full suite 1005/1005 across 113 files; lint/typecheck/Prettier/diff check passed; build passed before UI-only closure edit |

### Milestone 6.5 — Synthetic demo data

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P6-M5-T01 — Synthetic data specification** | Define privacy-safe reproducible demo patterns | Products/branches/history, seasonality, noise, known expected patterns | Analytics definitions | Seed spec contains no real personal/production data | Schema/expected-pattern review passed; specification closure passed and committed in `e8f0c71ff189280f3ca3f63f18b4b841b79b08c1` (`docs: define synthetic demo data specification`) |
| [x] **P6-M5-T02 — Generate and validate demo dataset** | Enable yearly/seasonal demos and experiments | Deterministic generator/seed using accepted lifecycle, documented size | T01, stable schema | Reproducible data; balances/history valid | Implemented in `5bd524768a00fbadef54b757f15dcc4ce85a7db2` (`feat: add synthetic demo dataset`); fresh generation, exact rerun no-op, partial/foreign fail-closed, ledger/balance/cost reconciliation, and Sales/refund/Analytics/Forecast/Reorder goldens passed; demo tests 17/17, opt-in integration 1/1, focused analytics 155/155, full suite 1,023 passed across 115 files; lint/typecheck/build/Prettier/diff check passed. See `docs/ANALYTICS.md` and `docs/DEMO_DATA.md` |

## Phase 7 — Scheduled AI insights

Phase 7 is COMPLETE under `ADR-033`, which resolves `OQ-017` and `OQ-018`.
Milestone 7.1 is COMPLETE: P7-M1-T01 and P7-M1-T02 are complete. P7-M1-T01's
specification/decision commit is `d5a8170aeb3c0fae74190695d130cef80acaba65`;
final specification closure passed. P7-M1-T02 was implemented in `506f690`
(`feat: add analytics snapshot store`): versioned deterministic Organization/
Branch aggregate snapshots cover daily/weekly/monthly/yearly periods, persist no
PII or raw rows, and use an immutable idempotent store. Historical Branch
due-instant authority supports ADR-033 eligibility, with prehistory unavailable.
Closure passed, including 14 migrations from zero and demo generation plus exact
no-op rerun with manifest, reconciliation, and Analytics/Forecast/Reorder
goldens; focused tests 38/38 and full suite 1,031 passed, 1 skipped across 118
files; Prisma validate/generate, lint, typecheck, build, Prettier, and diff check
passed. Milestone 7.2 is COMPLETE: P7-M2-T01 is COMPLETE in
`227303f` (`feat: add OpenRouter AI provider`); P7-M2-T02 is COMPLETE in
`2ff4832` (`feat: add AI summary prompt policy`); P7-M2-T03 is COMPLETE in
`69f61be` (`feat: add idempotent AI insight job`). P7-M3-T01 and P7-M3-T02
are COMPLETE. Milestone 7.3 is COMPLETE. Milestone 7.4 is COMPLETE: T01/T02
accepted; post-remediation T03 accepted with the named L04 observation limitation.
Historical T03 execution/counts remain unchanged; MT-L04 remains BLOCKED.
`STOCKOUT_RISK` remains deferred/unassigned; P0-M2-T05 remains unchecked.
The 2026-09-30 pre-baseline amendment to `ADR-033` now requests
`openrouter/free` on every attempt without paid-model fallback; historical
P7-M1/P7-M2 task rows below record their original completion scope.

### Milestone 7.1 — AI decision gate and snapshots (COMPLETE)

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P7-M1-T01 — Close schedule/provider decisions** | Define safe bounded AI operation | Resolve `OQ-017`, `OQ-018`; times, catch-up, model, fallback, timeout, budget, prompt/retention | Phase 6 | All docs/ADR/config contract updated | Failure/budget/privacy threat review passed; ADR-033 specification/decision committed in `d5a8170aeb3c0fae74190695d130cef80acaba65`; final specification closure passed |
| [x] **P7-M1-T02 — Analytics snapshot schema/store** | Persist versioned aggregate AI inputs | Daily/weekly/monthly/yearly scope/period, completeness, uniqueness | T01, accepted metrics | No PII/raw rows; reproducible/idempotent snapshots | Implemented in `506f690` (`feat: add analytics snapshot store`); immutable/idempotent Organization/Branch aggregates with no PII/raw rows; historical Branch due-instant authority for ADR-033. Closure passed: 14 migrations from zero, demo generation and exact no-op rerun with manifest/reconciliation/Analytics/Forecast/Reorder goldens, focused 38/38, full suite 1,031 passed and 1 skipped across 118 files, Prisma validate/generate, lint, typecheck, build, Prettier, and diff check |

### Milestone 7.2 — OpenRouter adapter and generation (COMPLETE)

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P7-M2-T01 — AI provider abstraction/OpenRouter client** | Isolate provider safely | Typed internal provider boundary; fixed OpenRouter Chat Completions adapter; explicit primary/retry/fallback, 15-second per-call timeout, three-call maximum, request/output bounds, server-only optional key; no database dependency or router model | P7-M1 | Provider cannot access DB; invalid output rejected | Implemented in `227303f` (`feat: add OpenRouter AI provider`); focused 38/38, full suite 1,064 passed and 1 skipped; lint/typecheck/build passed |
| [x] **P7-M2-T02 — Prompt version and data minimization** | Ensure summary-only behavior | Versioned prompt, snapshot allow-list, prose/content validation | T01 | No prohibited fields; prompt forbids invented calculations | Implemented in `2ff4832` (`feat: add AI summary prompt policy`): server-owned V1 prompt, strict aggregate allow-list, generic scope labels, no IDs/PII/raw rows, plain-text validation; focused 54/54, full suite 1,085 passed and 1 skipped, lint/typecheck/build passed; no dependencies added |
| [x] **P7-M2-T03 — Idempotent insight job** | Generate/persist one scheduled report | Claim, snapshot, provider, persisted success/failure/provenance/retry | T01–T02 | Duplicate trigger bounded; core system unaffected by failure | Implemented in `69f61be` (`feat: add idempotent AI insight job`): database-enforced identity and tenant-safe scope/snapshot links; pins snapshot/schema/metric/prompt versions; concurrent claims converge; reserves at most three attempts and fails closed after ambiguous provider activity; successful insights immutable; no raw prompt/error retention. Closure passed: T03 DB 11/11, schema inventory 16/16, provider/prompt/snapshot 60/60, demo 1/1, full suite 1,097 passed and 1 intentionally skipped, root typecheck/build in isolated Linux, lint, Prisma, Prettier, and diff check |

### Milestone 7.3 — Four cadences and dashboard (COMPLETE)

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P7-M3-T01 — Cadence orchestration** | Support daily/weekly/monthly/yearly identities | Callable internal orchestration of due periods and scopes through the P7-M2-T03 job; no runtime timer, scheduler persistence, API/UI, or AWS resources | P7-M2 | Organization timezone and ADR-029 half-open periods; due at 06:00 local with DST gap/overlap rules; bounded two-period catch-up oldest first; Branch active-at-original-due eligibility | Implemented in `6c68b5c` (`feat: add AI insight cadence orchestration`): DAILY/WEEKLY/MONTHLY/YEARLY, active-at-due Branch history and fail-closed skips, deterministic sequential execution, and T03 idempotent delegation with no direct provider calls; focused closure 56/56, full suite 1,117 passed and 1 intentionally skipped; lint/typecheck/build passed, zero dependency additions |
| [x] **P7-M3-T02 — Persisted insight API** | Read reports without provider calls | GET-only persisted list/latest/detail; `AI_BUSINESS_SUMMARY_VIEW` && `BUSINESS_ANALYTICS_VIEW` && `SALES_COST_VIEW`; OWNER/ADMIN organization scope incl. retained inactive-Branch history, BRANCH_MANAGER active assigned Branch only; tenant-scoped IDs/cursors; business-period latest/lastSuccess/structural stale; repeatable-read pair; historical versions and safe status/provenance | T01 | Zero provider calls on reads; safe stale/failure states | Implemented in `8af00151f073ead3efe57d81f2fbce6dcda8fb20` (`feat: add persisted AI insight API`); focused 9/9, combined T02/T03/T01 23/23, full suite 1,126 passed and 1 intentionally skipped; lint/typecheck/build passed; no schema migration or dependency additions |
| [x] **P7-M3-T03 — Insight dashboard UI** | Present summaries responsibly | Cadence/scope/freshness/data-state/content-safe rendering | T02 | AI labeled as summary; deterministic metrics accessible | Implemented in `df8084b9b6a19c7d5a9149c9daa67396bcc007de` (`feat: add AI insight dashboard`): `/app/analytics` AI Insights view with role-aware scopes, four cadences, persisted states and periods, API-timezone formatting, and plain-text summaries; deterministic Sales remains default and accessible. Focused 45/45, web 200/200, E2E 7/7; full suite 1,148 passed and 1 intentional skip using a 20-second test-only timeout after one unrelated test exceeded the default 5 seconds; lint/typecheck/build/Prettier/diff check passed; no dependency/backend/schema changes |

### Milestone 7.4 — Pre-Cloud Readiness (COMPLETE; ACCEPTED WITH L04 VERIFICATION LIMITATION)

This is a PRE-CLOUD LOCAL gate to establish and validate the final local
application baseline before AWS. Delivery sequence: Phase 7 feature implementation
→ Milestone 7.4 Stable/LTS baseline → automated local regression → full manual
local UAT → PRE-CLOUD READY → Phase 8 AWS cloud delivery. Phase 8 remains NOT
STARTED and owns AWS infrastructure and integration testing. This milestone is not production
hardening, AWS security validation, production-like testing, cloud load testing,
or the final dependency/container/IaC security audit. Those remain Phase 9 work.

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P7-M4-T01 — Stable/LTS runtime and dependency baseline (COMPLETE)** | Establish the supported pre-cloud runtime/dependency baseline | Review current Node.js, pnpm, Next.js, React, Express, Prisma, Zod, Vitest, Playwright, TypeScript, PostgreSQL, Docker images, and other relevant direct runtime/build dependencies. Prefer supported stable/LTS and compatible, justified patch/minor versions; do not chase a major version solely because it is newer; no beta/RC/canary/preview. Pin/reproduce versions and inspect deprecations/compatibility; major upgrades require explicit justification and impact review. | Phase 7 feature implementation | Document accepted versions; no knowingly obsolete/unsupported critical runtime; review compatibility; exact changes reviewable before regression testing | Verified/accepted 2026-10-02: Node 24.21.0, Next/plugin 16.3.8, PostgreSQL 16.15, API/web Node types 24.19.0; compatible transitive security fixes. Frozen install, Prisma validate/generate, lint/typecheck/build, tracked-file formatting, 1,149 passed/1 intentional skip, and Chromium smoke 9/9 passed. Root format fails only on preserved untracked diagrams; two MySQL-only Prisma tooling advisories deferred. See `docs/P7-M4-T01-BASELINE.md`; these are T01 results, not T02 evidence. |
| [x] **P7-M4-T02 — Post-baseline automated regression (COMPLETE / VERIFIED / ACCEPTED)** | Prove the accepted Stable/LTS baseline did not break StockWise | Reproducible install; Prisma validate/generate; migrations from zero on a fresh guarded database; lint, typecheck, build, full automated suite and relevant E2E; demo fixture; container startup/smoke; authentication and business-critical regressions as applicable. | T01; completed application features | Automated gates pass on the final local baseline; migrations/schema remain reproducible; no unresolved baseline-induced regression; exact accepted versions are those carried into Manual UAT | Full automated regression and applicable guarded database, E2E, demo, and container checks. Fresh 2026-10-02: frozen install; Prisma validate/generate; 15 migrations from zero; lint/typecheck/build/format; 1,150 tests, zero skips; Chromium 23/23; demo generation/no-op/goldens; PostgreSQL and compiled app smoke PASS. Additional pre-existing refund FK-name drift disclosed, no baseline-induced regression. See `docs/P7-M4-T02-REGRESSION.md`. |
| [x] **P7-M4-T03 — Full local manual business UAT (POST-REMEDIATION ACCEPTED WITH L04 LIMITATION)** | Manually validate feature-complete StockWise business workflows locally before AWS complexity | Human-executed UAT plan covering identity, email verification where configured, password lifecycle, onboarding, invitations, memberships, branch context; OWNER/ADMIN/BRANCH_MANAGER/INVENTORY_STAFF/CASHIER permissions and tenant/Branch isolation; Category/Product, Supplier, Inventory/adjustments, Purchasing/PO/Receiving, POS/payment, Sales History/receipt/refund/restock; Sales/Category/Branch/Inventory analytics, Forecast, Reorder; and scheduled AI snapshot generation plus provider/job/persisted insight flows once Phase 7.2/7.3 exist. Each case records prerequisite, actor/role, steps, expected UI/API result, expected business/database effect where relevant, negative/auth test, edge cases, and pass/fail evidence. | T02; feature-complete local application | Critical accepted flows manually exercised; failures resolved or explicitly blocking; no known blocker to AWS deployment; local application declared PRE-CLOUD READY | Human-executed plan with recorded outcomes and evidence; this task defines the plan, not UAT tooling |

P7-M4-T01/T02 remain COMPLETE (verified/accepted). Historical T03 execution is
CONCLUDED / NOT ACCEPTED at its original checkpoint: 250 PASS /7 FAIL /3 BLOCKED
/0 N/A /0 pending=260; see docs/P7-M4-T03-UAT.md. Later REM-01/REM-VERIFY-01
establish all eight findings VERIFIED FIXED and M11/P08 PASS. User explicitly
accepted L04's tooling-observation limitation on2026-10-04; MT-L04 stays BLOCKED,
with native layout/clipping/scaling/pagination/blank-page behavior unverified.
Final canonical review accepts post-remediation T03 with this limitation:
P7-M4 COMPLETE, Phase7 COMPLETE, PRE-CLOUD READY YES; Phase8 NOT STARTED.
See [final acceptance](docs/P7-M4-ACCEPTANCE.md). This local
compatibility/regression/UAT gate does not replace **P9-M1-T02 — Dependency/
container/IaC security review**, the final security-oriented audit in deployed/
cloud context, or **P9-M4-T01 — End-to-end regression**, the complete regression
in a production-like environment after cloud/hardening. Phase 9 retains production/
cloud hardening, security, resilience, performance, experiments, and final
production-readiness.

## Post-Phase-7 UI maintenance

This work preserves Phase 7 completion and PRE-CLOUD READY YES; Phase 8 remains
NOT STARTED. It does not alter historical UAT evidence or the accepted MT-L04
limitation.

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [x] **P7-POST-M2-T01 — Desktop application sidebar and authentication navigation** | Make existing application destinations available across pages | Shared access-context-aware desktop sidebar, compact mobile menu, scoped Home/logo links, existing Log out flow; remove Home module-button navigation | Accepted Phase 7 local gate | Correct authenticated/signed-out navigation, role/scope visibility, accessible responsive behavior; no backend policy/session changes | Focused 46/46; full 1180 PASS/1 conditional demo SKIP/0 FAIL; focused Chromium 5/5 and production Chromium suite 32/32; axe checks, screenshot review, lint/format/typecheck/web build and diff checks passed 2026-10-05; no commit |

## Phase 8 — AWS cloud delivery

### Milestone 8.1 — Production architecture and IaC decision gate

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P8-M1-T01 — Close hosting/operations decisions** | Select exact AWS topology | Resolve `OQ-015`, `OQ-020`; region, compute/Next hosting, ingress/TLS/DNS, secrets, IaC, availability, backup/recovery/cost | Stable MVP apps | ADR/architecture/threat/cost model updated | Architecture failure/cost/recovery review |
| [ ] **P8-M1-T02 — Infrastructure-as-code foundation** | Make cloud reproducible | Approved IaC, environment separation, state/identity policy, tags/budgets | T01 | Reviewable least-privilege plan; no manual drift as default | Format/validate/plan in non-mutating review |

### Milestone 8.2 — Network, data, storage, and compute

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P8-M2-T01 — VPC and security boundaries** | Isolate production resources | Subnets/routes/security groups/endpoints as accepted | P8-M1 | RDS not public; least network access | IaC policy/plan and connectivity tests |
| [ ] **P8-M2-T02 — RDS PostgreSQL** | Deploy protected system of record | Encryption, backups, maintenance, monitoring, parameter/connection plan | T01 | App connects privately; recovery controls match target | Connectivity, migration rehearsal, backup/restore drill |
| [ ] **P8-M2-T03 — S3 object storage if required** | Store accepted assets safely | Buckets, encryption, access, CORS/lifecycle for defined assets only | P8-M1, accepted asset requirements | No public blanket access; tenant object ownership | Access/CORS/size/type/lifecycle tests |
| [ ] **P8-M2-T04 — Dockerized web/API compute and ingress** | Deploy accepted application topology | Images, runtime compute, TLS/health/rollout/rollback | P8-M1, app builds | Immutable images; secrets external; healthy rollout/rollback | Image scan, smoke, health, failure rollback |

### Milestone 8.3 — Scheduling, observability, and delivery

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P8-M3-T01 — EventBridge scheduled execution** | Run four cadences in production | Rules/targets/permissions/retry/dead-letter behavior as accepted | Phase 7, cloud compute | Least-privilege triggers; idempotent catch-up | Controlled trigger/duplicate/failure test |
| [ ] **P8-M3-T02 — CloudWatch observability** | Detect operational failure | Structured logs, metrics, dashboards, alerts, retention/redaction | Cloud resources, `OQ-020` | Checkout/receipt/job/DB/provider signals visible | Alarm simulation and log-secret audit |
| [ ] **P8-M3-T03 — GitHub Actions deployment** | Automate safe build/deploy | Quality gates, image build/scan, approved deploy environments/rollback | CI + cloud | Least-privilege; protected prod approval; traceable artifact | Dry run/staging deploy/rollback validation |
| [ ] **P8-M3-T04 — SQS need assessment** | Avoid premature queue | Measure scheduled workload/retry/backpressure; propose ADR only if needed | Running scheduled jobs | Either documented no-need or accepted bounded queue design | Load/failure experiment; no default provisioning |

## Phase 9 — Hardening and experiments

### Milestone 9.1 — Security, privacy, and resilience

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P9-M1-T01 — Threat model and authorization audit** | Validate tenant/branch/security design | Assets, trust boundaries, abuse cases, RBAC endpoints/jobs/S3/AI | Deployed feature-complete MVP | High risks remediated/tracked; permission matrix verified | Cross-tenant/branch/role adversarial suite |
| [ ] **P9-M1-T02 — Dependency/container/IaC security review** | Remove known avoidable risk | Dependency audit, image scan, IaC policy, secret scan | Phase 8 | No unresolved critical finding without owner acceptance | Repeatable CI scans + false-positive review |
| [ ] **P9-M1-T03 — Backup/restore and disaster recovery validation** | Prove data recoverability | RDS restore, app recovery, RPO/RTO evidence, runbook | `OQ-020`, RDS | Restore succeeds within accepted targets | Timed restore/reconciliation drill |
| [ ] **P9-M1-T04 — AI privacy and failure audit** | Verify summary-only boundary | Snapshot data inventory, prompt/output/log review, retry budget/outage | Phase 7/8 | No prohibited data; outage isolation demonstrated | Static fixtures + provider outage/invalid output tests |

### Milestone 9.2 — Performance and UX hardening

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P9-M2-T01 — Load and concurrency test** | Validate accepted performance targets | Checkout, inventory, list/query, dashboard, job concurrency | `OQ-020`, production-like env | p95/error/concurrency targets met or bottleneck documented/fixed | Reproducible load profile and DB plan evidence |
| [ ] **P9-M2-T02 — Query/index optimization** | Fix measured database bottlenecks | Slow queries, `EXPLAIN` evidence, index changes | T01 | Improvements demonstrated without write regression | Before/after plans and integration tests |
| [ ] **P9-M2-T03 — Accessibility/responsive audit** | Make critical flows usable across devices | Keyboard/screen reader/contrast/touch/layout/print | Feature-complete UI | Accepted accessibility issues resolved/tracked | Automated + manual PC/tablet/phone audit |

### Milestone 9.3 — Forecast, cloud, and cost experiments

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P9-M3-T01 — Forecast experiment** | Compare V1 with named baseline | Time-ordered backtest on reproducible data; MAE/RMSE/WAPE as selected | Phase 6, demo data | Method/data/results/limitations reproducible; no leakage | Re-run produces same reported metrics |
| [ ] **P9-M3-T02 — Scaling/failure experiment** | Demonstrate cloud/software behavior | Controlled load/failure such as API scale, DB pressure, or scheduled retry | Phase 8 | Hypothesis, setup, metrics, result, limitation documented | Repeatable run and evidence capture |
| [ ] **P9-M3-T03 — AWS cost analysis** | Estimate MVP and growth cost | Assumptions, service usage, baseline/growth scenarios, cost controls | Exact topology | Traceable monthly estimates and optimization trade-offs | Independent arithmetic/input review |
| [ ] **P9-M3-T04 — SQS/architecture re-evaluation** | Revisit complexity using evidence | Review job/load results; keep monolith or propose future ADR | T01–T03 | No service/queue added without measured justification | Architecture review against evidence |

### Milestone 9.4 — Production-readiness handoff

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P9-M4-T01 — End-to-end regression** | Validate complete accepted workflow | Identity -> organization/branch -> product/supplier -> inventory -> PO/receipt -> POS/sales -> analytics -> Forecasting V1 -> reorder recommendation -> scheduled AI insight | All feature phases | Critical happy/failure paths pass in production-like env | Full E2E, security, concurrency, backup smoke |
| [ ] **P9-M4-T02 — Operations and limitation runbooks** | Make operation/recovery reviewable | Deploy/rollback, migration, alerts, backup/restore, provider outage, known limits | Phase 8/9 evidence | Another operator can follow; no secrets | Tabletop/runbook walkthrough |
| [ ] **P9-M4-T03 — Final documentation consistency** | Align delivered system and Source of Truth | All docs, API/schema/commands/plan/ADRs/experiment results | T01–T02 | No stale planned-as-built statements; remaining OQs explicit | Automated scans + manual traceability audit |

## 2. Next Codex task

Phase 1, Phase 2, Milestone 3.1, Milestone 3.2, the deferred-transfer decision gate,
Phase 4 purchasing/receiving work, Phase 5, Milestone 6.1, Milestone 6.2, Milestone
6.3, and P6-M4-T01/T02 are complete. `ADR-029` resolves `OQ-011` and `OQ-016`;
the current Analytics foundation implements reporting time, period, scope, source
cutoff, completeness, base Sales metrics, Category/Branch dimensions, and
Sales/Category/Branch HTTP and UI.
**P6-M3-T01 — Movement and coverage metrics** is complete at `c74bc098`.
**P6-M3-T02 — Stock risk analytics** is complete at `f25adbf5`. `ADR-030`
accepts fixed coverage-based classification. **P6-M3-T03 — Inventory analytics
API/UI** is complete at `1043c58cefea41699929e83d2579856ba9182ede` (`feat: expose
inventory analytics`). It exposes the accepted T01/T02 facts through the authenticated
inventory endpoint and `/app/analytics`, with scoped opaque pagination, current/event
time markers, and separate cost authorization. No risk ranking or Top-N was added.
`ADR-031` resolves `OQ-012` for Forecasting V1 through **P6-M4-T01 — Close
Forecasting V1**. **P6-M4-T02 — Forecast implementation** is complete in
`68a3e995696924d35afdabf7c8e27dcc098101e0`. **P6-M4-T03 — Reorder
recommendation** is complete: `ADR-032` accepts its policy and internal advisory
`reorder-v1` is implemented in `977f33f0588fc42547a60fc6a17f28fea131cdc5`.
**P6-M4-T04 — Forecast/reorder API/UI** is complete in
`89c5d722a0088e9fb930082bd423ebdb1adc455f`; its authorized Forecast/Reorder
endpoints and `/app/analytics` view are available. The view remains advisory and
does not auto-order. All Phase 6 tasks, including P6-M5-T01 and P6-M5-T02, are
complete. Phase 6 is COMPLETE. `STOCKOUT_RISK` remains deferred/unassigned
pending a separate accepted policy. Phase 7 is COMPLETE; Milestone 7.1 is
COMPLETE, Milestone 7.2 is COMPLETE, and Milestone 7.3 is COMPLETE. P7-M1-T01,
P7-M1-T02, P7-M2-T01, P7-M2-T02, P7-M2-T03, P7-M3-T01, P7-M3-T02, and
P7-M3-T03 are COMPLETE. Milestone 7.4 is COMPLETE; **P7-M4-T01 — Stable/LTS
runtime and dependency baseline** is COMPLETE (verified/accepted).
P7-M4-T02 is COMPLETE (verified/accepted); post-remediation T03 acceptance is
satisfied with explicitly accepted L04 limitation. Historical execution unchanged;
MT-L04 BLOCKED. PRE-CLOUD READY YES; Phase8 NOT STARTED.

Current-state constraints that the next task must preserve:

- `OQ-001` is resolved by `ADR-011`: Node.js 24 LTS, pnpm 11.19.0, and native `apps/*`/`packages/*` workspaces.
- The root contains pinned TypeScript, ESLint, Prettier, Vitest, Playwright Chromium, axe, and Next-specific lint tooling with verified `build`, `dev:api`, `dev:web`, `start:api`, `start:web`, `format`, `format:check`, `lint`, `test`, `test:e2e`, and `typecheck` scripts.
- Vitest discovers root and workspace `*.test.ts`/`*.test.tsx` files, excludes `tests/e2e` files, and applies committed migrations to the guarded test database. Coverage includes authorization policy; authentication/credential lifecycle; onboarding and branch/member access; catalog; inventory; suppliers; purchase orders; receiving; atomic checkout; Sales API/history/refunds; and Analytics period/scope/metrics/dimensions/HTTP/UI. `pnpm test:e2e` runs 23 isolated Chromium scenarios against the same-origin Next.js rewrite, Express, and guarded disposable PostgreSQL target.
- The root `.env.example` documents the active web/API loopback contract, redacted Docker-only `STOCKWISE_POSTGRES_*` placeholders, API-only `DATABASE_URL`, required runtime mode, session idle/absolute/touch values, and the required stable API-only Analytics cursor HMAC key. `apps/web` and `apps/api` retain separate strict Zod environment schemas; the API validates `DATABASE_URL` as a PostgreSQL URL and the web schema does not accept it.
- Web/API configuration ownership, client/server exposure boundaries, local/test rules, and later-task deferrals are documented in `AGENTS.md`.
- `.github/workflows/ci.yml` reproduces the frozen install, format-check, lint, typecheck, test, and build gates for pushes and pull requests with read-only repository permission and immutable action pins.
- `apps/web` contains the Next.js App Router root shell, Tailwind/shadcn baseline, TanStack Query provider, strict environment boundary, same-origin health and `/api/v1` rewrites, authentication/onboarding, URL-owned `/app` context, Catalog, Inventory, branch/member, Supplier, Purchase Order/Receiving, POS, `/app/sales` Sales History/detail/browser-receipt/refund UI, and `/app/analytics` Sales/Category/Branch/Inventory/Forecast/Reorder views. Inventory analytics uses the API-produced facts/classification, role-aware navigation/cache identity, and opaque pagination; forecast/reorder quantities and statuses also remain API-authoritative. It has no Next.js business Route Handlers, persisted selection authority, VOID UI, or branch-price behavior. The browser receipt uses the existing Sale detail response and remains original-Sale-only; no separate receipt or refund-document endpoint exists.
- `OQ-002` is resolved by `ADR-012`: App Router under `src/app`, Server Components by default, justified Client Components only, deferred Route Groups, and Express-owned business REST APIs.
- `OQ-003`–`OQ-011`, `OQ-016`, `OQ-021`, and `OQ-022` are resolved by
  `ADR-013`–`ADR-029`. `ADR-029` fixes Organization reporting timezone, canonical
  periods, event attribution, Analytics V1 metrics, cost/null/decimal semantics, and
  threshold deferrals then in force. `ADR-030` later accepts fixed V1
  coverage-based low/normal/overstock classification. `ADR-031` resolves `OQ-012`
  for Forecasting V1; `ADR-032` accepts Reorder V1 policy. Forecast-derived
  risk and `STOCKOUT_RISK` still require separate accepted rules;
  `OQ-019` remains open beyond refund-owned immutable attribution/provenance; and
  `OQ-020` remains open beyond its narrow application-level limiter exceptions.
- `OQ-013` is resolved by `ADR-025` as **DEFERRED FROM MVP**. Stock transfer remains broader/full future scope, but no transfer schema, API, UI, permission, lifecycle, ledger-source, or idempotency contract is implemented or frozen.
- `apps/api` contains the Express app/server bootstrap, safe transport/errors, Prisma client, all accepted authentication endpoints, first onboarding, `GET /me/access-context`, branch lifecycle endpoints, invitation/member workflows, Catalog, Inventory, Supplier, Purchase Order, Receiving, Sales, and the Analytics period/scope/base-Sales/Category/Branch/Inventory/Forecast/Reorder repositories and services with authenticated analytics endpoints. Metrics use set-based PostgreSQL statements and exact Decimal derivation. Sales includes bounded Organization VAT configuration, completed Sale/SaleItem/Payment snapshots and constraints, `SALE_CHECKOUT` hashes, tenant-safe negative `SALE` ledger provenance, atomic checkout, POS reads/checkout transport, branch-scoped history/detail reads with field-level cost permission, and immutable linked SaleRefund/SaleRefundItem/RefundPayment compensation with optional positive `SALE_REFUND_RETURN` stock/cost effects. Existing protected writes continue to derive the verified actor, re-evaluate centralized policy and tenant scope, and serialize their accepted invariants.
- The Next.js web-to-API integration uses same-origin `/api/health` and `/api/v1/:path*` rewrites to loopback Express; Express CORS remains disabled. Supplier management, Purchase Orders, Receiving, checkout/POS, Sales History/detail/browser receipt, the bounded refund workflow, and Sales/Category/Branch/Inventory/Forecast/Reorder Analytics HTTP/UI exposure are implemented. Forecasting V1 and Reorder V1 remain deterministic; forecast/reorder presentation uses server-authoritative values and statuses. P7-M2-T01 implements the OpenRouter provider adapter, P7-M2-T02 implements prompt preparation, and P7-M2-T03 implements the idempotent insight job/persistence; P7-M3-T01 implements callable due-period orchestration, P7-M3-T02 implements persisted insight reads, and P7-M3-T03 implements the `/app/analytics` dashboard UI. The runtime timer remains unimplemented.
- Git metadata is present, but P1-M1-T05 did not create a commit or perform any remote action.

### Current final acceptance handoff — P7-M4 COMPLETE with accepted L04 limitation

Final canonical review is [P7-M4-ACCEPTANCE](docs/P7-M4-ACCEPTANCE.md),
2026-10-04/main/d66bb7720c015d636a732ee4b6db931c41eb65e2. All eight product
findings VERIFIED FIXED; M11/P08 PASS; MT-L04 remains BLOCKED with explicitly
accepted tooling-observation limitation. Native preview layout, clipping, scaling,
pagination and blank-page behavior remain unverified. Latest L04 attempt made
zero new print invocations; this acceptance review made no additional attempt.
Historical T03 remains250 PASS/7 FAIL/3 BLOCKED, NOT ACCEPTED at its original
checkpoint. Current post-remediation acceptance is satisfied with the limitation;
P7-M4/Phase7 COMPLETE; PRE-CLOUD READY YES; Phase8 NOT STARTED.
Refund FK-name reconciliation and deferred MySQL-tooling advisories remain separate
follow-ups, not newly introduced P7-M4 blockers. No product/runtime change.
Final closure commit is explicitly authorized as P7-M4-FINAL-CLOSURE-COMMIT.
After that isolated documentation commit, STOP. No push, provider call, further
L04 attempt or follow-up implementation. Phase8 requires separate explicit
authorization in a NEW THREAD.

### Historical REM-VERIFY-01 handoff — before L04 disposition

P7-M4-REM-01 is committed at edcdc42832002951a6cedc1c70840102625fdef2.
Its preceding automated gates remain recorded in [REM-01](docs/P7-M4-REM-01.md).
The separate authorized P7-M4-REM-VERIFY-01 directly verifies MT-001–007 and
T03-AI-001 as VERIFIED FIXED, with real UI/persistence and controlled local AI
responses. Headed390px viewport/375px client and supplementary390/375px client
checks fit; tablet/desktop comparisons pass. MT-M11 independent timezone and
MT-P08 normal client-JS cookie observations PASS. MT-L04 native print preview
remains BLOCKED after one bounded attempt. See [VERIFY-01](docs/P7-M4-REM-VERIFY-01.md).

Historical T03 remains 250 PASS /7 FAIL /3 BLOCKED /0 N/A /0 pending; acceptance
NOT MET, P7-M4 incomplete and PRE-CLOUD READY NO. No product finding remains
OPEN in the separate follow-up; MT-L04 is the remaining required observation.
Next: review the unstaged documentation; authorize any commit separately.
Native preview needs direct evidence or a separately explicit accepted disposition
before acceptance can be reconsidered. No automatic waiver, Git action, provider
call, FK-name/advisory repair or Phase 8 work.

### Historical T03 closure handoff — before REM-01 authorization

```text
THREAD: SAME THREAD
MODEL: GPT-6.1 Sol
EFFORT: High
SKILLS: project-operating-standard; stockwise-source-of-truth-change-gate

Read AGENTS.md, PROJECT_PLAN.md, docs/P7-M4-T03-UAT.md and final-state-20261004.json
in the preserved P7-M4-T03-20261002 evidence namespace. All260 classified:
250 PASS /7 FAIL /3 BLOCKED /0 N/A /0 pending; MT-P01–P06 PASS, lastMT-P06.
T03 acceptance NOT MET; P7-M4 incomplete; PRE-CLOUD READY NO; Phase8 not started.
Org B approved OWNER membership is ACTIVE and retained; Org A roles/scopes unchanged;
manager Branch B INACTIVE. No completed-case rerun, new account/reset/sign-in flow,
fixture cleanup, extra provider call, environment recreation or DB reset/reseed.
MT-001–007 and T03-AI-001 remain OPEN; L04/M11/P08 BLOCKED. B22 PASS supporting
revocation evidence retains original-tab continuity limitation. Refund FK-name drift
and deferred Prisma MySQL-tooling advisories remain separate follow-up.
STOP and wait for explicit user authorization before commit, fixes, additional
verification, scope cleanup or another milestone. No stage/commit/push/PR/merge/tag.
```
