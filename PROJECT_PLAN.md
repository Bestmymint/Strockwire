# StockWise Project Plan

| Field | Value |
| --- | --- |
| Project | StockWise |
| Plan baseline | Architecture Freeze v1 |
| Repository state | Implemented and verified through P5-M3; P5-M4 refund contract accepted |
| Last updated | 2026-09-19 |

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
| [ ] **P0-M2-T05 — Analytics/forecast gate** | Finalize numerical truth before analytics/forecast implementation | `OQ-011` is resolved by `ADR-029`; resolve remaining `OQ-012` while preserving TypeScript/SQL calculation and summary-only LLM boundary | Before affected Phase 6 implementation | Every implemented metric/forecast/reorder rule has one accepted definition/version | Analytics fixtures/time-boundary review completed 2026-09-20; forecast backtest design and leakage review remain |

The unchecked decision-gate tasks do **not** block Phase 1 repository/tooling, application shells, or unrelated work. Each gate blocks only the affected business-domain implementation. Cloud/operations questions such as `OQ-015`, `OQ-017`–`OQ-020` remain open until their relevant phases.

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
| [ ] **P6-M3-T01 — Movement and coverage metrics** | Compute accepted velocity/coverage | ADS, coverage, fast/slow classifications as accepted | P6-M1, inventory/sales | Explicit zero/insufficient states | Fixed data, zero demand, negative-stock reconciliation anomaly, branch tests |
| [ ] **P6-M3-T02 — Stock risk analytics** | Compute deterministic low/stockout/overstock risk | Only classifications later accepted by `OQ-012` or a separate threshold decision; no LLM | T01 plus resolved threshold/forecast dependency | Explainable inputs/status; no arbitrary thresholds | Threshold/boundary/insufficient fixtures |
| [ ] **P6-M3-T03 — Inventory analytics API/UI** | Deliver risk/movement views | Planned endpoints/charts/tables/filters | T01–T02 | Accessible, scoped, versioned outputs | API/UI/E2E/security/empty tests |

### Milestone 6.4 — Forecast and replenishment

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P6-M4-T01 — Close Forecasting V1** | Define one testable baseline/candidate | Resolve `OQ-012`; target/grain/horizon/data/features/cold start/evaluation | P6-M1 | `docs/ANALYTICS.md`/ADR/plan updated; no Python service | Backtest design review and leakage check |
| [ ] **P6-M4-T02 — Forecast implementation** | Produce versioned deterministic forecasts | TypeScript/SQL algorithm, data status, reproducible inputs | T01 | Repeatable output and known baseline comparison | Unit/backtest/time-order/zero/new-product tests |
| [ ] **P6-M4-T03 — Reorder recommendation** | Turn accepted inputs into guidance | Lead time, safety stock, incoming, on-hand, order rounding as accepted | T02, P4 decisions | Explainable recommendation; never auto-order | Formula/boundary/missing-input tests |
| [ ] **P6-M4-T04 — Forecast/reorder API/UI** | Present estimates and limitations | Endpoints, filters, version/data status/limitations | T02–T03 | No LLM numbers; accessible uncertainty/insufficient state | API/UI/E2E/security tests |

### Milestone 6.5 — Synthetic demo data

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P6-M5-T01 — Synthetic data specification** | Define privacy-safe reproducible demo patterns | Products/branches/history, seasonality, noise, known expected patterns | Analytics definitions | Seed spec contains no real personal/production data | Schema/expected-pattern review |
| [ ] **P6-M5-T02 — Generate and validate demo dataset** | Enable yearly/seasonal demos and experiments | Deterministic generator/seed using accepted lifecycle, documented size | T01, stable schema | Reproducible data; balances/history valid | Seed repeatability, reconciliation, analytics known-result tests |

## Phase 7 — Scheduled AI insights

### Milestone 7.1 — AI decision gate and snapshots

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P7-M1-T01 — Close schedule/provider decisions** | Define safe bounded AI operation | Resolve `OQ-017`, `OQ-018`; times, catch-up, model, fallback, timeout, budget, prompt/retention | Phase 6 | All docs/ADR/config contract updated | Failure/budget/privacy threat review |
| [ ] **P7-M1-T02 — Analytics snapshot schema/store** | Persist versioned aggregate AI inputs | Daily/weekly/monthly/yearly scope/period, completeness, uniqueness | T01, accepted metrics | No PII/raw rows; reproducible/idempotent snapshots | Schema validator, duplicate, tenant, content audit tests |

### Milestone 7.2 — OpenRouter adapter and generation

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P7-M2-T01 — AI provider abstraction/OpenRouter client** | Isolate provider safely | Typed request/response, timeout, bounded retry/fallback/budget, secret-safe telemetry | P7-M1 | Provider cannot access DB; invalid output rejected | Adapter contract, timeout/rate/error/secret tests |
| [ ] **P7-M2-T02 — Prompt version and data minimization** | Ensure summary-only behavior | Versioned prompt, snapshot allow-list, prose/content validation | T01 | No prohibited fields; prompt forbids invented calculations | Snapshot privacy fixtures and adversarial content tests |
| [ ] **P7-M2-T03 — Idempotent insight job** | Generate/persist one scheduled report | Claim, snapshot, provider, persisted success/failure/provenance/retry | T01–T02 | Duplicate trigger bounded; core system unaffected by failure | Concurrency, crash-point, retry, provider failure tests |

### Milestone 7.3 — Four cadences and dashboard

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P7-M3-T01 — Cadence orchestration** | Support daily/weekly/monthly/yearly identities | Local/test scheduler adapter and production EventBridge contract | P7-M2 | Period/catch-up/idempotency correct for all cadences | Time boundary, duplicate, missed-run fixtures |
| [ ] **P7-M3-T02 — Persisted insight API** | Read reports without provider calls | List/latest/detail, safe status/provenance, scope | T01 | Zero provider calls on reads; safe stale/failure states | API/security/empty/stale/version tests |
| [ ] **P7-M3-T03 — Insight dashboard UI** | Present summaries responsibly | Cadence/scope/freshness/data-state/content-safe rendering | T02 | AI labeled as summary; deterministic metrics accessible | UI/E2E/accessibility/XSS-safe rendering tests |

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
| [ ] **P9-M1-T04 — AI privacy and failure audit** | Verify summary-only boundary | Snapshot data inventory, prompt/output/log review, budget/fallback/outage | Phase 7/8 | No prohibited data; outage isolation demonstrated | Static fixtures + provider outage/invalid output tests |

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
Phase 4 purchasing/receiving work, Phase 5, Milestone 6.1, and Milestone 6.2
are complete. `ADR-029` resolves `OQ-011` and `OQ-016`; the current Analytics
foundation implements reporting time, period, scope, source cutoff, completeness,
base Sales metrics, Category/Branch dimensions, and Sales/Category/Branch HTTP and UI.
**P6-M3-T01 — Movement and coverage metrics** is the next remaining task.

Current-state constraints that the next task must preserve:

- `OQ-001` is resolved by `ADR-011`: Node.js 24 LTS, pnpm 11.19.0, and native `apps/*`/`packages/*` workspaces.
- The root contains pinned TypeScript, ESLint, Prettier, Vitest, Playwright Chromium, axe, and Next-specific lint tooling with verified `build`, `dev:api`, `dev:web`, `start:api`, `start:web`, `format`, `format:check`, `lint`, `test`, `test:e2e`, and `typecheck` scripts.
- Vitest discovers root and workspace `*.test.ts`/`*.test.tsx` files, excludes `tests/e2e` files, and applies committed migrations to the guarded test database. Coverage includes authorization policy; authentication/credential lifecycle; onboarding and branch/member access; catalog; inventory; suppliers; purchase orders; receiving; atomic checkout; Sales API/history/refunds; and Analytics period/scope/metrics/dimensions/HTTP/UI. `pnpm test:e2e` runs 19 isolated Chromium scenarios against the same-origin Next.js rewrite, Express, and guarded disposable PostgreSQL target.
- The root `.env.example` documents the active web/API loopback contract, redacted Docker-only `STOCKWISE_POSTGRES_*` placeholders, API-only `DATABASE_URL`, required runtime mode, session idle/absolute/touch values, and the required stable API-only Analytics cursor HMAC key. `apps/web` and `apps/api` retain separate strict Zod environment schemas; the API validates `DATABASE_URL` as a PostgreSQL URL and the web schema does not accept it.
- Web/API configuration ownership, client/server exposure boundaries, local/test rules, and later-task deferrals are documented in `AGENTS.md`.
- `.github/workflows/ci.yml` reproduces the frozen install, format-check, lint, typecheck, test, and build gates for pushes and pull requests with read-only repository permission and immutable action pins.
- `apps/web` contains the Next.js App Router root shell, Tailwind/shadcn baseline, TanStack Query provider, strict environment boundary, same-origin health and `/api/v1` rewrites, authentication/onboarding, URL-owned `/app` context, Catalog, Inventory, branch/member, Supplier, Purchase Order/Receiving, POS, `/app/sales` Sales History/detail/browser-receipt/refund UI, and `/app/analytics` Sales/Category/Branch views. It has no Next.js business Route Handlers, persisted selection authority, VOID UI, or branch-price behavior. The browser receipt uses the existing Sale detail response and remains original-Sale-only; no separate receipt or refund-document endpoint exists.
- `OQ-002` is resolved by `ADR-012`: App Router under `src/app`, Server Components by default, justified Client Components only, deferred Route Groups, and Express-owned business REST APIs.
- `OQ-003`–`OQ-011`, `OQ-016`, `OQ-021`, and `OQ-022` are resolved by
  `ADR-013`–`ADR-029`. `ADR-029` fixes Organization reporting timezone, canonical
  periods, event attribution, Analytics V1 metrics, cost/null/decimal semantics, and
  explicit threshold deferrals. `OQ-012` remains open for forecasting/risk/reorder;
  `OQ-019` remains open beyond refund-owned immutable attribution/provenance; and
  `OQ-020` remains open beyond its narrow application-level limiter exceptions.
- `OQ-013` is resolved by `ADR-025` as **DEFERRED FROM MVP**. Stock transfer remains broader/full future scope, but no transfer schema, API, UI, permission, lifecycle, ledger-source, or idempotency contract is implemented or frozen.
- `apps/api` contains the Express app/server bootstrap, safe transport/errors, Prisma client, all accepted authentication endpoints, first onboarding, `GET /me/access-context`, branch lifecycle endpoints, invitation/member workflows, Catalog, Inventory, Supplier, Purchase Order, Receiving, Sales, and the Analytics period/scope/base-Sales/Category/Branch repositories and services with authenticated Sales, Category, and Branch HTTP endpoints. Metrics use set-based PostgreSQL statements and exact Decimal derivation. Sales includes bounded Organization VAT configuration, completed Sale/SaleItem/Payment snapshots and constraints, `SALE_CHECKOUT` hashes, tenant-safe negative `SALE` ledger provenance, atomic checkout, POS reads/checkout transport, branch-scoped history/detail reads with field-level cost permission, and immutable linked SaleRefund/SaleRefundItem/RefundPayment compensation with optional positive `SALE_REFUND_RETURN` stock/cost effects. Existing protected writes continue to derive the verified actor, re-evaluate centralized policy and tenant scope, and serialize their accepted invariants.
- The Next.js web-to-API integration uses same-origin `/api/health` and `/api/v1/:path*` rewrites to loopback Express; Express CORS remains disabled. Supplier management, Purchase Orders, Receiving, checkout/POS, Sales History/detail/browser receipt, the bounded refund workflow, and Sales/Category/Branch Analytics HTTP/UI exposure are implemented. Inventory analytics, AI, AWS resources, deployment, and release automation remain unimplemented.
- Git metadata is present, but P1-M1-T05 did not create a commit or perform any remote action.

### Handoff prompt

```text
Read AGENTS.md and all Source of Truth documents, then inspect the current repository before changing files.

Task: P6-M3-T01 — Movement and coverage metrics

Implement only the accepted inventory movement/coverage definitions in
`docs/ANALYTICS.md` and the P6-M3-T01 plan row. Preserve the Analytics V1 period,
scope, source-cutoff, and null/Decimal contracts. Do not begin risk/forecast,
AI, or infrastructure work.

Preserve existing tenant, branch, authorization, Decimal, stock-ledger, shared-lock, ADR-026 cost, immutable Sale/Payment/history/refund, repository-foundation, API/web, environment, and CI invariants. Do not commit without separate authorization.
```
