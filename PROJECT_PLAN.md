# StockWise Project Plan

| Field | Value |
| --- | --- |
| Project | StockWise |
| Plan baseline | Architecture Freeze v1 |
| Repository state | Repository foundation plus verified minimal Next.js web and Express API shells |
| Last updated | 2026-08-22 |

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
| [ ] **P0-M2-T03 — Identity/onboarding/authorization gate** | Finalize rules before identity-domain implementation | Resolve `OQ-003`, `OQ-005`, `OQ-022` for authenticated state, onboarding, and the accepted MVP roles | Before affected Phase 2 implementation | Decisions accepted; build/data/API/use cases/ADR and permission matrix updated consistently | Auth flow, tenant/branch, delegation, escalation, and last-owner scenario review |
| [ ] **P0-M2-T04 — Inventory/purchasing/sales gate** | Finalize stock, money, cost, and quantity rules before affected operations | Resolve `OQ-007`, `OQ-008`, `OQ-010`, `OQ-023`; resolve `OQ-009` before refund/void | Before affected Phase 3–5 implementation | Worked examples and affected contracts agree; no domain rule remains implicit | Stock, decimal, costing, checkout, receiving, refund/void boundary scenarios |
| [ ] **P0-M2-T05 — Analytics/forecast gate** | Finalize numerical truth before analytics/forecast implementation | Resolve `OQ-011`, then `OQ-012`; preserve TypeScript/SQL calculation and summary-only LLM boundary | Before affected Phase 6 implementation | Every implemented metric/forecast/reorder rule has one accepted definition/version | Hand-calculated fixtures, time-boundary review, backtest design and leakage review |

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
| [ ] **P1-M2-T04 — Web-to-API development path** | Validate local integration | Approved origins/proxy/CORS strategy, typed base client boundary, one health view | Web/API shells | Browser reaches API without disabling security broadly | Integration test + build + manual responsive smoke |

### Milestone 1.3 — Local data foundation

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P1-M3-T01 — Local PostgreSQL and Docker setup** | Provide reproducible disposable development database | Docker configuration, healthcheck, volumes, safe local credentials/examples | P1-M1-T01, P1-M1-T04 | Documented start/stop; no production credentials; data target explicit | Container health/connectivity smoke |
| [ ] **P1-M3-T02 — Prisma foundation** | Establish safe schema/migration workflow | Initialize Prisma for PostgreSQL, generated client location, empty/foundation migration policy, scripts | P1-M1-T02, T01 | Client generation and disposable migration work; `docs/DATABASE.md` naming conventions updated | Generate/validate/migrate on disposable DB |
| [ ] **P1-M3-T03 — Database test harness** | Enable real integration/concurrency tests | Isolated test database/schema, reset strategy restricted to disposable target, transaction helpers | T01, T02 | Repeatable parallel-safe test setup; production URL guard | Run repeated DB smoke and target-safety tests |

## Phase 2 — Identity, organizations, and branches

### Milestone 2.1 — Identity decision gate and schema

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P2-M1-T01 — Close identity/onboarding decisions** | Unblock identity implementation | `OQ-003`–`OQ-006`, `OQ-022`; permission matrix and threat review | Phase 1 | Accepted decisions update build/data/API/use cases/ADR | Cross-doc trace; abuse-case review |
| [ ] **P2-M1-T02 — Identity and tenancy schema** | Persist users, organizations, branches, memberships | Prisma models/constraints/indexes/migration for accepted fields only | T01, P1-M3 | Same-tenant relationships, multi-branch users, preserved actor history | Migration + uniqueness/FK/cross-tenant DB tests |
| [ ] **P2-M1-T03 — Authorization policy foundation** | Centralize RBAC + branch scope | Typed permission vocabulary, trusted request context, policy tests; no endpoint wiring yet | T01, T02 | Organization/branch decisions evaluated in one policy layer | Permission matrix + escalation unit tests |

### Milestone 2.2 — Authentication

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P2-M2-T01 — Registration and Argon2** | Create secure email/password accounts | Validation, normalization, hashing, duplicate/rate limit behavior | P2-M1, P1-M2-T02 | No plaintext exposure; accepted verification/next step | API/unit/integration + duplicate/rate/security tests |
| [ ] **P2-M2-T02 — Login and authenticated context** | Establish accepted auth state | Credential verification, session/token creation, middleware, safe user context | T01, `OQ-003` | Protected request resolves actor safely | Auth lifecycle, expiry/revocation, invalid credential tests |
| [ ] **P2-M2-T03 — Logout and credential recovery** | End/recover access safely | Logout semantics; verification/reset only as accepted | T02, `OQ-003`, `OQ-004` | Revocation matches decision; provider failures safe | Replay/expiry/provider/security tests |
| [ ] **P2-M2-T04 — Authentication UI** | Provide accessible auth flows | Registration/login/logout/verification/reset states only as accepted | T01–T03, web shell | Responsive, accessible, safe error UI | Component/integration/E2E happy and failure paths |

### Milestone 2.3 — Onboarding and access management

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P2-M3-T01 — Profile and first organization onboarding** | Establish first usable tenant/branch | Accepted profile, organization, first branch, owner role; idempotent atomic flow | P2-M2, `OQ-005` | No partial/duplicate onboarding | API/DB/E2E invalid/retry/concurrency tests |
| [ ] **P2-M3-T02 — Branch management and switcher** | Support multiple branches per user | Branch CRUD allowed by policy; accessible list; frontend context switch/cache invalidation | T01, authorization policy | Server revalidates every branch; no stale cross-branch UI | API/security/UI/E2E revocation and switch tests |
| [ ] **P2-M3-T03 — Membership invitation/assignment** | Manage staff scope | Accepted invite, role, branch assignment, deactivate flow | P2-M2, `OQ-006`, `OQ-022` | No privilege delegation/escalation violation | Matrix, duplicate, expiry, last-owner, cross-tenant tests |

## Phase 3 — Products and inventory

### Milestone 3.1 — Catalog decision gate and models

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P3-M1-T01 — Close catalog/quantity decisions** | Unblock catalog and inventory representation | `OQ-014`, `OQ-023`, `OQ-024`; product units/precision, branch price MVP, master-data normalization/lifecycle | Phase 2 foundation | Accepted docs/ADR/API/data updates | Cross-doc and decimal/unit/lifecycle examples |
| [ ] **P3-M1-T02 — Category and product schema** | Persist organization catalog safely | Models, uniqueness, statuses, same-tenant category relation, migration | T01 | SKU/barcode tenant constraints; no branch stock field | DB/migration/duplicate/cross-tenant tests |
| [ ] **P3-M1-T03 — Catalog API** | Manage/search catalog | Category/product list/create/read/update/deactivate, cursor search, Zod | T02, authorization | Historical references preserved; safe errors | API integration/security/pagination tests |
| [ ] **P3-M1-T04 — Catalog UI** | Provide responsive catalog management | Lists/search/forms/status/empty/error states | T03 | Accessible PC/tablet/phone behavior | Component/integration/E2E + accessibility |

### Milestone 3.2 — Inventory decision gate and ledger

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P3-M2-T01 — Close negative-stock/adjustment decisions** | Define balance invariant and permissions | `OQ-007`, adjustment reasons/approvals, audit impact `OQ-019` | P3-M1, P2 policy | Data/API/use case/ADR updated | Boundary scenarios and permission review |
| [ ] **P3-M2-T02 — Balance and ledger schema** | Store branch stock traceably | Inventory balance/transaction, source uniqueness, indexes, migration | T01 | Unique branch/product balance; append ledger; same-tenant invariant | Migration/FK/constraint/reconciliation tests |
| [ ] **P3-M2-T03 — Inventory query/history API** | Read balances and ledger | Paginated inventory/history, stable filters/scope | T02 | Accurate isolated balance/history | API pagination, empty, tenant/branch tests |
| [ ] **P3-M2-T04 — Atomic adjustment service/API** | Safely change stock by delta | Idempotency, locking/version strategy, ledger+balance transaction | T01–T03 | No lost update/double adjust; accepted stock rule | DB concurrency, rollback, idempotency, permission tests |
| [ ] **P3-M2-T05 — Inventory UI** | Operate/read branch stock | Balance/history/adjustment UI, reason/permission/error states | T03–T04 | Responsive and accessible; no direct balance edit illusion | Component/integration/E2E concurrency/conflict state |

### Milestone 3.3 — Optional branch transfer gate

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P3-M3-T01 — Decide stock-transfer MVP** | Include or defer explicitly | Resolve `OQ-013`; if included, full in-transit lifecycle/permissions | P3-M2 | Accepted ADR/docs/plan; no ambiguous movement pair | Lifecycle/concurrency/dual-branch scenario review |
| [ ] **P3-M3-T02 — Implement transfer lifecycle if accepted** | Trace stock between branches | Separate bounded plan generated only if included | T01, explicit acceptance | Both branches reconcile; no unrelated adjustments | Atomic/state/idempotency/permission/E2E tests |

## Phase 4 — Suppliers and purchasing

### Milestone 4.1 — Purchasing decision gate and supplier

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P4-M1-T01 — Close costing and receiving decisions** | Unblock historical cost and receipt lifecycle | `OQ-010`, `OQ-021`; partial/over receipt, returns, cost/rounding | Phase 3 | All affected documents and ADR updated | Worked examples and state-transition review |
| [ ] **P4-M1-T02 — Supplier model/API/UI** | Manage organization suppliers | Schema/migration, scoped CRUD/deactivation, responsive UI | Phase 2, T01, `OQ-024` | Same-tenant scope; history-safe deactivate | DB/API/UI/security tests |

### Milestone 4.2 — Purchase orders

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P4-M2-T01 — Purchase order schema/lifecycle** | Persist branch-targeted orders and snapshots | Order/items, accepted states, totals/cost, constraints/indexes/migration | P4-M1 | Same-tenant supplier/products/branch; immutable non-editable states | Migration, state, decimal, FK tests |
| [ ] **P4-M2-T02 — Purchase order API** | Create/edit/list/read accepted lifecycle | Zod, authorization, pagination, concurrency/version checks | T01 | No stock change before receipt; stable errors | API/security/state/duplicate/stale tests |
| [ ] **P4-M2-T03 — Purchase order UI** | Operate orders responsively | List/detail/editor/status/validation/error states | T02 | Historical snapshots shown; disabled invalid actions | Component/integration/E2E/accessibility |

### Milestone 4.3 — Atomic receiving

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P4-M3-T01 — Receipt schema and receiving service** | Receive into stock exactly once | Receipt/items, PO protection, cost update, ledger/balance, idempotency | P4-M2, inventory service | Receipt/order/cost/ledger/balance commit together | Failure injection, concurrency, idempotency, reconciliation |
| [ ] **P4-M3-T02 — Receiving API** | Expose atomic receive command | Validated quantities/cost, role/scope, response/error contract | T01 | No partial API workflow; safe retry | API/authorization/conflict/deadlock tests |
| [ ] **P4-M3-T03 — Receiving UI** | Guide receipt entry and outcomes | Remaining quantities, actual cost, conflicts, retry-safe status | T02 | UI prevents obvious invalid input; server remains authority | Component/integration/E2E partial/failure cases as accepted |

## Phase 5 — POS and sales

### Milestone 5.1 — Sales decision gate and model

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P5-M1-T01 — Close payment/tax/discount/receipt decisions** | Define checkout monetary contract | `OQ-008`; methods/states, rounding, numbering, tender/change, split behavior | Phase 4 | Worked examples and all docs/ADR updated | Decimal/rounding/payment scenario review |
| [ ] **P5-M1-T02 — Sale/payment schema** | Persist immutable sales truth | Sale/items/payment/idempotency/status/indexes/migration; cost snapshot per `OQ-010` | T01 | Historical snapshots; branch/actor; no deletions | Migration/constraint/decimal/history tests |

### Milestone 5.2 — Atomic checkout

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P5-M2-T01 — Server checkout service** | Commit sale/payment/stock atomically | Reload product/price, totals, lock order, stock policy, idempotency, transaction | P5-M1, inventory | Exactly one consistent sale or rollback; no provider dependency | Failure injection, oversell concurrency, deadlock/idempotency, decimal tests |
| [ ] **P5-M2-T02 — POS product search and checkout API** | Expose safe POS operations | Sellable search/barcode and `POST sales`; validation/auth/error mapping | T01 | Client totals ignored; safe scoped responses | API/security/price-change/stock/payment tests |
| [ ] **P5-M2-T03 — Responsive POS UI** | Provide touch-friendly cart/checkout | Search/barcode input, cart, server reconciliation, payment/error/success states | T02 | Usable PC/tablet/phone; duplicate submit protected | Component/integration/E2E/accessibility/responsive |

### Milestone 5.3 — History and receipts

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P5-M3-T01 — Sales history/detail API** | Read stable branch history | Pagination/filter/detail, field-level cost permission | P5-M2, permission matrix | Uses snapshots; no cross-branch leak | API/security/pagination/catalog-change tests |
| [ ] **P5-M3-T02 — Sales history and browser receipt UI** | Review and print sales | List/detail/filter/print, empty/error/loading states | T01 | Responsive printable receipt with accepted numbering | UI/E2E/print stylesheet/accessibility tests |

### Milestone 5.4 — Reversal gate

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P5-M4-T01 — Decide refund/void rules** | Define reversal lifecycle | Resolve `OQ-009` with payment, stock, time, approval, audit, partial rules | P5-M2 | Data/use case/API/analytics/ADR updated | State/money/stock worked examples |
| [ ] **P5-M4-T02 — Implement reversal if in MVP** | Create traceable compensating workflow | Separate bounded schema/service/API/UI plan based on accepted rules | T01, explicit scope | Original history immutable; stock/payment consistent | Failure/concurrency/idempotency/permission/E2E tests |

## Phase 6 — Analytics and forecasting

### Milestone 6.1 — Definitions and period engine

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P6-M1-T01 — Close metric/timezone decisions** | Make analytics executable | Resolve `OQ-011`, `OQ-016`; eligible states, periods, comparisons, thresholds | Stable sales/inventory | Every metric in `docs/ANALYTICS.md` accepted/deferred with examples | Hand-calculated fixtures and boundary review |
| [ ] **P6-M1-T02 — Period and scope engine** | Canonicalize time/authorized aggregation | Period selectors/boundaries, branch set resolution, completeness metadata | T01 | Half-open windows; no unauthorized branch; reproducible context | Timezone/boundary/DST-if-applicable/security tests |

### Milestone 6.2 — Deterministic sales analytics

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P6-M2-T01 — Base sales metrics** | Compute accepted totals/count/AOV/growth | SQL/TypeScript definitions and version metadata | P6-M1 | Exact fixture agreement; decimal/null semantics | Unit + DB integration + zero/partial tests |
| [ ] **P6-M2-T02 — Category and branch analytics** | Compare authorized dimensions | Category performance, branch comparison, rankings only if accepted | T01 | Same period/definition; included branch scope disclosed | Multi-branch/category/history-change/security tests |
| [ ] **P6-M2-T03 — Sales analytics API/UI** | Deliver accessible views | Planned endpoints, TanStack Query, Recharts plus text/table states | T01–T02 | No formula duplicated in UI; responsive accessible display | API/UI/E2E/accessibility/empty/stale tests |

### Milestone 6.3 — Inventory analytics

| Status / Task | Objective | Scope | Dependencies | Acceptance | Testing |
| --- | --- | --- | --- | --- | --- |
| [ ] **P6-M3-T01 — Movement and coverage metrics** | Compute accepted velocity/coverage | ADS, coverage, fast/slow classifications as accepted | P6-M1, inventory/sales | Explicit zero/insufficient states | Fixed data, zero demand, negative stock, branch tests |
| [ ] **P6-M3-T02 — Stock risk analytics** | Compute deterministic low/stockout/overstock risk | Accepted thresholds/input facts; no LLM | T01, forecast if required | Explainable inputs/status; no arbitrary thresholds | Threshold/boundary/insufficient fixtures |
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

The next implementation task is **P1-M2-T04 — Web-to-API development path**. This record does not authorize starting it in the P1-M2-T03 task.

Current-state constraints that the next task must preserve:

- `OQ-001` is resolved by `ADR-011`: Node.js 24 LTS, pnpm 11.19.0, and native `apps/*`/`packages/*` workspaces.
- The root contains pinned TypeScript, ESLint, Prettier, Vitest, and Next-specific lint tooling with verified `build`, `dev:api`, `dev:web`, `start:api`, `start:web`, `format`, `format:check`, `lint`, `test`, and `typecheck` scripts.
- Vitest discovers root and workspace `*.test.ts`/`*.test.tsx` files, excludes future `tests/e2e` files, and currently runs the root smoke test plus web and API shell tests.
- The root `.env.example` remains a comment-only ownership and handling contract with no active variables, values, or secrets. `apps/web` and `apps/api` own separate strict empty Zod environment schemas.
- Web/API configuration ownership, client/server exposure boundaries, local/test rules, and later-task deferrals are documented in `AGENTS.md`.
- `.github/workflows/ci.yml` reproduces the frozen install, format-check, lint, typecheck, test, and build gates for pushes and pull requests with read-only repository permission and immutable action pins.
- `apps/web` contains only the Next.js App Router root shell, Tailwind/shadcn baseline, TanStack Query provider, and environment/test boundary. It has no feature routes, Route Handlers, authentication, API client, or product/domain behavior.
- `OQ-002` is resolved by `ADR-012`: App Router under `src/app`, Server Components by default, justified Client Components only, deferred Route Groups, and Express-owned business REST APIs.
- `apps/api` contains the Express app/server bootstrap, empty `/api/v1` boundary, root-level `/health` and `/ready` operational probes, safe transport middleware/errors, structured request telemetry, shutdown lifecycle, and strict empty environment boundary. It has no business endpoint or domain-module directory.
- No web-to-API integration, Prisma/PostgreSQL/Docker setup, domain code, analytics, AI, AWS resource, deployment, or release automation exists.
- Git metadata is present, but P1-M1-T05 did not create a commit or perform any remote action.

### Handoff prompt

```text
Read AGENTS.md and all Source of Truth documents, then inspect the current repository before changing files.

Task: P1-M2-T04 — Web-to-API development path

Follow the exact task row and affected Source of Truth documents. Add only the assigned web-to-API development path behavior, preserving the existing safe operational probe semantics.

Preserve the repository-foundation, web/API-shell, health/readiness, environment-contract, and CI baselines. Keep work within web-to-API integration scope; do not begin database, domain, analytics, AI, cloud, deployment, or release tasks, and do not commit anything without separate authorization.
```
