# StockWise Use Case Specifications

| Field | Value |
| --- | --- |
| Status | Behavioral Source of Truth; Architecture Freeze v1 with explicit blockers |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-24 |

## 1. How to use this document

This document owns user- and system-visible behavior, including alternative flows and failures. Product scope is in `BUILD_SPEC.md`; exact HTTP shapes are in `docs/API.md`; data invariants are in `docs/DATABASE.md`; formulas are in `docs/ANALYTICS.md`.

Statuses:

- **Ready after foundation:** behavior is defined enough to plan once repository/database prerequisites exist.
- **Blocked:** one or more `OQ-*` decisions must be accepted before implementation.
- **Future:** not in the current MVP.

Global rules for every protected use case:

1. The API authenticates the actor and derives organization/branch scope from trusted memberships.
2. A client-supplied identifier selects a candidate resource; it never grants access.
3. Invalid and unauthorized requests do not partially mutate data.
4. Cross-tenant resources are not disclosed.
5. All writes record sufficient actor, time, and source context for traceability.

The accepted MVP RBAC roles are `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`. One organization role is assigned per user/organization; `OWNER`/`ADMIN` are organization-wide and the remaining roles require explicit branch assignments. The API enforces the capability and governance baseline in `BUILD_SPEC.md` section 8; frontend checks are UX only.

## 2. Identity, organization, and access

### UC-IAM-001 — Register with email and password

- **Status:** Ready after identity foundation
- **Actor:** New user
- **Preconditions:** The service is available; the submitted email may be new or already registered under the accepted normalization rule.
- **Trigger:** The user submits the email/password registration form.
- **Main flow:**
  1. The client validates basic form shape and submits over TLS.
  2. The API validates the required email and the 15–128 Unicode-code-point
     password without trimming, normalizing, truncating, or applying composition rules.
  3. The API normalizes the email and checks uniqueness without leaking account details.
  4. The API hashes the password with Argon2.
  5. The API creates the user with `emailVerifiedAt = null` and
     `displayName = null`; P2-M2-T01 creates no verification token and sends no email.
  6. The API returns the same generic `202 Accepted` verification-next-step response for a new account and a canonical-email duplicate; registration alone does not create authenticated state, organization access, or branch access.
- **Alternative flows:** Canonical-email duplicate and concurrent duplicate requests preserve exactly one account and receive the same public response as a new account. Verification-token creation, resend, provider integration/delivery, and verification are handled later by P2-M2-T03.
- **Error cases:** Invalid email/password; exhausted rate limit; database conflict or failure; hashing failure; request retry. Expected uniqueness conflicts are absorbed into the generic response. No plaintext password, email limiter key, raw database error, or internal error is logged/returned.
- **Business rules:** Email/password is the only MVP sign-up method; Google login is future. Passwords allow whitespace and Unicode, have no character-class composition requirements, and are preserved exactly before Argon2id hashing. Breached-password screening is deferred. Five attempts per canonical email per 15 minutes are allowed by a deterministic process-local in-memory limiter; exhaustion returns `429` with `Retry-After`. Duplicate requests must not create multiple accounts.
- **Authorization:** Public endpoint with abuse controls; creates no organization/branch privilege by itself.
- **Expected result:** Exactly one unverified account exists for the canonical email and the public response does not reveal whether this request created it.
- **Acceptance criteria:** PHC-encoded accepted Argon2id verifier stored; plaintext absent from storage/logs; duplicate and concurrent requests return the generic `202`; invalid input rejected; rate limiting and `Retry-After` tested; no verification token, email delivery, session, organization, or branch access created accidentally.

### UC-IAM-002 — Sign in with email and password

- **Status:** Ready after identity foundation
- **Actor:** Registered user
- **Preconditions:** An account exists and is permitted to authenticate under verification/status policy.
- **Trigger:** The user submits email and password.
- **Main flow:**
  1. The API validates and normalizes input.
  2. It locates the account using non-disclosing behavior.
  3. It verifies the Argon2 password hash.
  4. It checks account status/verification rules.
  5. It atomically rotates a currently valid same-user session when present,
     creates a fresh opaque server-side session, and sets its HttpOnly cookie.
  6. It returns only the safe authenticated actor fields `id`, canonical `email`,
     and nullable `displayName`. Organization/branch options are resolved by
     later onboarding and access-management work.
- **Alternative flows:** A verified account with incomplete profile/onboarding can authenticate but is limited to the next required setup route. Disabled or deauthorized users lose access when authorization is evaluated.
- **Error cases:** Wrong email/password; unverified/disabled account; rate limit; expired/revoked state; database unavailable. Credential failure must not disclose whether an email exists.
- **Business rules:** Branch selection is not embedded as permanent user ownership. The browser never receives a JWT/refresh token or writes auth state to web storage; only the session hash is stored server-side. Login permits five failed credential attempts per canonical email per fixed 15-minute process-local window. Only credential failures count; success does not reset an active window. After five failures, subsequent attempts receive `429` and `Retry-After`. Sessions have sliding 24-hour idle and fixed seven-day absolute expiry baselines; successful authenticated requests persist at most one activity touch per 15 minutes.
- **Authorization:** Public endpoint with the accepted login abuse control. Login establishes authentication only and returns no membership, role, organization, branch, permission, or authorization state.
- **Expected result:** A valid user obtains authenticated state; invalid attempts have no side effect beyond safe security telemetry.
- **Acceptance criteria:** Generic credential error; fixed-window rate-limit tests; secret-safe logs; hash-only session persistence; secure cookie/rotation/expiry/touch behavior; safe actor-only response; strategy-specific security tests pass.

### UC-IAM-003 — Sign out

- **Status:** Ready after identity foundation
- **Actor:** Authenticated user
- **Preconditions:** The user has authenticated state.
- **Trigger:** The user selects sign out or the client invokes the logout action.
- **Main flow:**
  1. The API validates the current authenticated state.
  2. It revokes the current opaque session.
  3. The client receives the cleared session cookie; an explicit all-session action revokes every session for the user.
  4. Protected requests with the invalidated state fail.
- **Alternative flows:** An already expired/revoked session returns an idempotent successful result where safe.
- **Error cases:** Network interruption; session store unavailable; replayed logout; malformed credential. The client must not claim server-side revocation if it did not occur.
- **Business rules:** Ordinary sign-out revokes the current session only. User-wide session revocation is separately supported; password reset also revokes every user session.
- **Authorization:** Authenticated or safely idempotent for an already invalid session.
- **Expected result:** The revoked opaque session can no longer access protected resources.
- **Acceptance criteria:** Current/all-session revocation, expiry, and cookie cleanup are tested; repeated logout is safe; no other user's sessions are affected.

### UC-IAM-004 — Complete profile and organization onboarding

- **Status:** Ready after identity foundation
- **Actor:** Authenticated user with incomplete onboarding
- **Preconditions:** User may authenticate but has not completed required profile/organization setup.
- **Trigger:** The user submits the onboarding form.
- **Main flow:**
  1. The API validates required display name, organization name, and initial branch name; profile/branch phone and branch address are optional.
  2. It creates/updates the profile.
  3. It creates the organization and owner membership if that is the accepted flow.
  4. It creates the first branch if required.
  5. All related records commit atomically where partial onboarding would be invalid.
  6. The API returns the next permitted application context.
- **Alternative flows:** Joining by invitation uses UC-IAM-006 instead of creating a new organization; retry returns/resumes one logical onboarding result.
- **Error cases:** Invalid/missing fields; duplicate branch code; account already onboarded; invitation invalid; transaction failure; concurrent duplicate submission.
- **Business rules:** Profile photo, date of birth, gender, tax ID, company registration number, organization website/logo, and billing details are not MVP onboarding fields. Onboarding must not create duplicate organizations on retry.
- **Authorization:** Authenticated incomplete account; cannot alter another account or organization.
- **Expected result:** A consistent user/organization/branch context is established, or nothing is partially created.
- **Acceptance criteria:** Atomicity/idempotency tests; required fields exactly match decision; owner permission created correctly; no cross-user modification.

### UC-IAM-005 — Switch active branch

- **Status:** Ready after identity/authorization foundation
- **Actor:** Authenticated organization member
- **Preconditions:** The user has access to at least one active branch.
- **Trigger:** The user chooses a branch from the branch switcher or an authorized organization aggregate.
- **Main flow:**
  1. The client requests accessible branches.
  2. The user selects one branch.
  3. Every subsequent branch-scoped request names that candidate branch.
  4. The API verifies current membership and branch ownership on every request.
  5. The UI invalidates/refetches branch-dependent TanStack Query data.
- **Alternative flows:** Organization-wide view is available to `OWNER`/`ADMIN`; the active branch may be restored locally as navigation context but is revalidated.
- **Error cases:** Branch inactive; access revoked; branch from another organization; stale cached selection; network failure. The UI falls back to an allowed selection and shows a safe message.
- **Business rules:** Selection is navigation context, not authorization. One user can access multiple branches without separate accounts.
- **Authorization:** Active organization/branch membership and action permission.
- **Expected result:** The user sees only data from the selected authorized scope.
- **Acceptance criteria:** Cross-branch/tenant tests; revoked access takes effect server-side; cached queries do not display previous-branch data as current.

### UC-IAM-006 — Manage membership and branch assignment

- **Status:** Ready after identity foundation
- **Actor:** Owner or authorized administrator
- **Preconditions:** Actor has membership-management permission in the organization.
- **Trigger:** Actor invites/adds a member, changes role/branch assignment, or deactivates membership.
- **Main flow:** Validate target email, role, and branch scope; verify the actor's grant authority; issue/reissue the invitation or update membership; record actor/context; revoke newly invalid access; return current member view. Acceptance authenticates and verifies the invited email, then atomically and idempotently creates the organization membership and required branch assignments.
- **Alternative flows:** An existing user must authenticate as the invited verified email; a new user registers and verifies that same email before acceptance. Changed role/branch scope revokes and replaces the pending invitation.
- **Error cases:** Duplicate invite/membership; target/branch from another tenant; role escalation beyond actor; removal of the last required owner; expired invite; concurrent update.
- **Business rules:** Invitations are email-bound, hash-only, single-use opaque tokens that expire in seven days; reissue invalidates the prior active invite. No automatic account creation or naive cross-email account linking occurs. Historical actor references are preserved after deactivation.
- **Authorization:** `OWNER` manages owners and OWNER-only ownership actions; `OWNER`/`ADMIN` manage non-owner memberships. No user may grant permissions they do not control, and at least one OWNER must remain.
- **Expected result:** Membership accurately reflects the accepted role and branch scope without orphaning governance.
- **Acceptance criteria:** Horizontal/vertical escalation tests; duplicates safe; revoked branch access immediately denied; last-owner invariant tested.

### UC-BR-001 — Manage branches

- **Status:** Ready after identity foundation
- **Actor:** `OWNER` or `ADMIN`
- **Preconditions:** The actor is authenticated, belongs to the active organization, and has branch-management permission; branch name is required and phone/address are optional.
- **Trigger:** The actor creates a branch or submits an update/deactivation for an existing branch.
- **Main flow:**
  1. The API derives the organization from trusted authenticated membership and validates the candidate organization/branch identifiers.
  2. It validates the accepted branch fields and organization-scoped branch code rules.
  3. For updates/deactivation, it loads the branch within that organization and verifies current state and permission.
  4. It creates or updates the branch without changing its owning organization.
  5. Deactivation prevents new operations according to the accepted lifecycle while preserving historical inventory, purchasing, receiving, sales, and analytics records.
  6. It returns the current branch representation and safe state.
- **Alternative flows:** The first branch may be created atomically during onboarding under UC-IAM-004; reactivation or a restriction on deactivating the last active branch follows the finalized onboarding/governance rules rather than an invented default.
- **Error cases:** Missing/invalid fields; duplicate branch code; inaccessible or cross-tenant branch; unauthorized role; inactive organization; stale/concurrent update; deactivation blocked by an accepted governance rule; database failure.
- **Business rules:** A branch belongs to exactly one organization and cannot be moved between tenants after creation. Deactivation must not hard-delete or rewrite historical branch operational records. Client `organizationId`/`branchId` is never authorization proof.
- **Authorization:** `OWNER`/`ADMIN` only; `BRANCH_MANAGER` cannot create/delete branches or manage organization-wide settings.
- **Expected result:** One organization-scoped branch is created or safely updated/deactivated, or no mutation occurs.
- **Acceptance criteria:** Organization ownership, duplicate, permission, cross-tenant, stale-update, deactivation-history, and first/last-branch governance tests cover the accepted rules.

## 3. Catalog and inventory

### UC-CAT-001 — Create or update a product

- **Status:** Blocked by `OQ-010`, `OQ-014`, `OQ-023`, `OQ-024`
- **Actor:** Authorized owner/admin/inventory staff
- **Preconditions:** Actor has catalog permission in the organization; referenced category is accessible and active as required.
- **Trigger:** Actor submits product details.
- **Main flow:**
  1. Validate fields and normalize SKU/barcode.
  2. Derive organization from trusted context.
  3. Verify category belongs to that organization.
  4. Enforce organization-scoped SKU and optional barcode uniqueness.
  5. Create/update current catalog data.
  6. Return a safe product representation.
- **Alternative flows:** Deactivate/reactivate a product according to lifecycle rules; omit optional barcode/category.
- **Error cases:** Invalid decimal/quantity/unit; duplicate SKU/barcode; category from another tenant; stale update conflict; product referenced by history; database failure.
- **Business rules:** Product is organization-level. Branch price overrides must not be added until `OQ-014`. Updating catalog data never rewrites historical sale/receipt snapshots.
- **Authorization:** Product create/edit is allowed to `OWNER`, `ADMIN`, `BRANCH_MANAGER`, and `INVENTORY_STAFF` in their allowed scope; product deactivation excludes `INVENTORY_STAFF`.
- **Expected result:** One valid organization product is stored without cross-tenant references.
- **Acceptance criteria:** Validation, uniqueness, tenant, immutable-history, and unauthorized-role tests pass.

`UC-CAT-002` is already assigned to the existing branch-price-override question. Category management therefore uses the next stable ID without renumbering existing use cases.

### UC-CAT-003 — Manage categories

- **Status:** Blocked by `OQ-024`
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` in allowed scope
- **Preconditions:** The actor is authenticated in an active organization and has category-management permission.
- **Trigger:** The actor creates, updates, or deactivates an organization category.
- **Main flow:**
  1. The API derives the organization from trusted membership and validates the requested fields.
  2. It applies only the normalization/duplicate rules accepted through `OQ-024`.
  3. For update/deactivation, it loads the category inside the same organization and checks current state.
  4. It creates or updates/deactivates the category while preserving valid product references and history.
  5. It returns the current category representation.
- **Alternative flows:** Products may remain uncategorized if the accepted catalog rules allow it; any category merge, reassignment, reactivation, or deletion behavior must first be accepted under `OQ-024`.
- **Error cases:** Invalid/missing name; duplicate according to the accepted normalization rule; category from another organization; unauthorized role; stale update; referenced category operation not permitted; database failure.
- **Business rules:** Category is organization-scoped. This use case does not define normalization, duplicate-name, hard-deletion, merge, or reassignment policy; `OQ-024` owns those decisions. Deactivation must not silently break product references or rewrite historical sales/receipt data.
- **Authorization:** Create/edit follows catalog permission; deactivation is limited to `OWNER`, `ADMIN`, and `BRANCH_MANAGER`.
- **Expected result:** One valid organization category is created or safely updated/deactivated, or no mutation occurs.
- **Acceptance criteria:** Tenant, permission, accepted normalization/duplicate, product-reference, deactivation/history, stale-update, and failure tests pass.

### UC-INV-001 — View branch stock and inventory history

- **Status:** Ready after inventory foundation; some labels/classification blocked by `OQ-011`
- **Actor:** Authorized branch user or organization-level viewer
- **Preconditions:** Actor has access to the requested branch or authorized aggregate.
- **Trigger:** Actor opens inventory list/product history.
- **Main flow:**
  1. API validates scope, pagination, filters, and sorting.
  2. It returns current balances for accessible branch/product records.
  3. For history, it returns ledger movements in stable chronological order with source/actor context permitted to the role.
  4. UI distinguishes no balance record, zero balance, and unavailable data.
- **Alternative flows:** Organization view returns separate/aggregated branch data only when authorized; inactive products can be included by explicit filter.
- **Error cases:** Invalid cursor/filter; inaccessible branch/product; stale page cursor; database unavailable. Do not leak another tenant's product or movement.
- **Business rules:** Balance is a projection; ledger explains changes. Low/stockout labels use only accepted analytics definitions.
- **Authorization:** Branch inventory-read permission or organization-wide permission.
- **Expected result:** Actor sees consistent balance and traceable movements for allowed scope only.
- **Acceptance criteria:** Pagination stability; tenant/branch isolation; balance-ledger fixture reconciliation; empty/error states; no N+1 access pattern.

### UC-INV-002 — Adjust branch stock

- **Status:** Blocked by `OQ-007`, `OQ-023` and audit scope `OQ-019`
- **Actor:** Authorized inventory staff/manager
- **Preconditions:** Product and branch are active and in the same organization; actor has adjustment permission.
- **Trigger:** Actor submits signed adjustment quantity and required reason.
- **Main flow:**
  1. Validate quantity/reason and trusted scope.
  2. Load and concurrency-protect the branch/product balance.
  3. Enforce negative-stock and approval rules.
  4. Append one adjustment ledger entry with actor/context.
  5. Update balance in the same database transaction.
  6. Return new balance and movement reference.
- **Alternative flows:** A zero starting balance creates the balance projection if allowed; correction of a wrong adjustment uses a compensating adjustment, not editing history.
- **Error cases:** Zero/invalid quantity; missing reason; forbidden role; cross-tenant product; inactive resource; insufficient stock under rule; concurrent conflict; duplicate request; database failure.
- **Business rules:** No direct balance overwrite. No ledger deletion/edit. Idempotent retry must not double-adjust.
- **Authorization:** Explicit branch stock-adjust permission; view permission alone is insufficient.
- **Expected result:** Exactly one traceable movement and matching balance change, or no change.
- **Acceptance criteria:** Atomicity, concurrency, duplicate, negative-stock, permission, tenant, and reconciliation tests pass.

## 4. Suppliers and purchasing

### UC-SUP-001 — Manage suppliers

- **Status:** Blocked by `OQ-024`
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` in allowed scope
- **Preconditions:** The actor is authenticated in an active organization and has supplier-management permission.
- **Trigger:** The actor creates, updates, or deactivates an organization supplier.
- **Main flow:**
  1. The API derives the organization from trusted membership and validates accepted supplier fields.
  2. It applies only normalization/duplicate rules accepted through `OQ-024`.
  3. For update/deactivation, it loads the supplier within the same organization and verifies current state.
  4. It creates or updates/deactivates the supplier while retaining all Purchase Order and receipt references.
  5. It returns the current supplier representation.
- **Alternative flows:** Reactivation, supplier merge, or replacement is allowed only if `OQ-024` later defines it; inactive suppliers remain readable in historical Purchase Orders.
- **Error cases:** Invalid/missing fields; duplicate according to accepted normalization; cross-tenant supplier; unauthorized role; stale update; attempted unsafe deletion of a referenced supplier; database failure.
- **Business rules:** Supplier is organization-scoped. A supplier referenced by purchasing history must not be hard-deleted or rewritten to alter historical Purchase Orders/receipts. `OQ-024` owns duplicate, normalization, deactivation, and deletion policy.
- **Authorization:** Supplier create/edit is allowed to `OWNER`, `ADMIN`, `BRANCH_MANAGER`, and `INVENTORY_STAFF`; deactivation follows the applicable accepted lifecycle and role policy.
- **Expected result:** One valid organization supplier is created or safely updated/deactivated, or no mutation occurs.
- **Acceptance criteria:** Tenant, permission, accepted duplicate/normalization, stale-update, deactivation/history, unsafe-delete, and failure tests pass.

### UC-PUR-001 — Create or edit a purchase order

- **Status:** Blocked in detail by `OQ-010`, `OQ-021`, `OQ-023`, `OQ-024`
- **Actor:** Authorized inventory/purchasing user
- **Preconditions:** Supplier, products, and target branch are active and belong to the same organization.
- **Trigger:** Actor saves a new purchase order or edits an editable one.
- **Main flow:** Validate branch/supplier/products/quantities/costs; derive organization; compute accepted totals; create order and line snapshots; return current order.
- **Alternative flows:** Save draft and later submit if lifecycle accepts both; remove/edit lines only in accepted editable states.
- **Error cases:** Empty/duplicate line behavior; invalid quantity/cost; cross-tenant supplier/product/branch; non-editable state; stale update; numbering conflict; database failure.
- **Business rules:** Purchase order targets one branch. Historical line snapshots survive catalog changes. State transitions and totals must follow accepted purchasing/costing rules.
- **Authorization:** Purchasing-write permission for target branch.
- **Expected result:** One consistent branch purchase order without inventory movement until receiving.
- **Acceptance criteria:** Tenant constraints; state/validation tests; no stock change on order creation; decimal behavior; immutable state enforcement.

### UC-PUR-002 — Receive a purchase order into branch stock

- **Status:** Blocked by `OQ-007`, `OQ-010`, `OQ-021`, `OQ-023`
- **Actor:** Authorized receiving/inventory user
- **Preconditions:** Purchase order is in an accepted receivable state for the actor's branch.
- **Trigger:** Actor submits received quantities and actual costs with an idempotency key.
- **Main flow:**
  1. Validate request and authorization.
  2. Lock/protect the purchase-order receive state and required balances.
  3. Enforce remaining/over/partial receiving rules.
  4. Create receipt and immutable receipt items.
  5. Append `PURCHASE_RECEIVE` ledger entries.
  6. Update inventory balances and accepted costing state.
  7. Update order status.
  8. Commit everything and return the receipt.
- **Alternative flows:** Partial receiving, if accepted; safe retry returns the same receipt; concurrent receipt either serializes or conflicts safely.
- **Error cases:** Non-receivable/cancelled order; excessive/zero quantity; product mismatch; forbidden branch; duplicate idempotency key with different payload; cost invalid; transaction/deadlock failure.
- **Business rules:** Receipt, ledger, balance, cost, and order status are one transaction. Completed receipt is corrected through a future accepted reversal/return, not edited.
- **Authorization:** Receiving permission at the target branch.
- **Expected result:** One durable receipt and exactly matching stock/cost changes, or full rollback.
- **Acceptance criteria:** Failure injection at each step; duplicate/concurrent receiving tests; balance-ledger consistency; cross-tenant rejection; historical snapshots verified.

## 5. POS and sales

### UC-SALE-001 — Complete POS checkout

- **Status:** Blocked by `OQ-007`, `OQ-008`, `OQ-010`, `OQ-023`
- **Actor:** Authorized cashier/manager
- **Preconditions:** Actor has checkout permission for an active branch; cart has at least one active same-organization product.
- **Trigger:** Actor submits cart and payment intent with an idempotency key.
- **Main flow:**
  1. API validates request shape and actor/branch scope.
  2. Server reloads products/prices and rejects client-authoritative totals.
  3. Server calculates accepted subtotal, discounts, tax, total, payment, and snapshots.
  4. It concurrency-protects required inventory balances in deterministic order.
  5. It enforces negative-stock and product/payment rules.
  6. In one transaction it creates sale, sale items, payment, inventory ledger movements, and balance updates.
  7. It commits and returns stable sale/receipt data.
- **Alternative flows:** Safe retry with the same key/payload returns the same logical sale; barcode and text search both produce the same server-validated product intent.
- **Error cases:** Empty/invalid cart; duplicate product-line policy; changed/inactive/missing product; changed price; insufficient stock; forbidden branch; invalid payment; decimal/rounding mismatch; idempotency conflict; deadlock/serialization failure; database failure.
- **Business rules:** One sale belongs to one branch and acting user. Sale items are immutable snapshots. Core commit is all-or-nothing. LLM and analytics availability are irrelevant to checkout success.
- **Authorization:** Branch checkout permission; user cannot select another tenant/branch by request data.
- **Expected result:** Exactly one completed, internally consistent sale with matching inventory effects, or no operational mutation.
- **Acceptance criteria:** Server-total, atomic rollback, concurrency/oversell, idempotency, tenant/branch, decimal, history, and provider-independence tests pass.

### UC-SALE-002 — View sales history, sale details, and receipt

- **Status:** Ready after sales foundation; receipt format details blocked by `OQ-008`
- **Actor:** Cashier, manager, admin, or owner with relevant read permission
- **Preconditions:** At least authenticated access; requested scope is allowed.
- **Trigger:** Actor searches/browses sales or opens a sale/receipt.
- **Main flow:** Validate filters and scope; query paginated branch sales; load one allowed sale with immutable line/payment snapshots; render a browser-printable receipt.
- **Alternative flows:** `CASHIER` sees assigned-branch sales history as required for cashier operations; `OWNER`/`ADMIN` may query organization-wide history and `BRANCH_MANAGER` assigned-branch history.
- **Error cases:** Invalid range/cursor; inaccessible sale; revoked branch; missing historical optional product; database failure. Inaccessible and nonexistent records use safe behavior.
- **Business rules:** Historical names/prices/costs come from sale snapshots, not current product values. Receipt never exposes hidden cost to a role without permission.
- **Authorization:** Sales-read/receipt permission at resource branch; cost/margin fields need separate permission.
- **Expected result:** Accurate, stable historical representation scoped to actor.
- **Acceptance criteria:** Snapshot stability after catalog change; pagination/filter tests; cost-field authorization; cross-tenant and inaccessible-branch tests; printable responsive view.

### UC-SALE-003 — Void or refund a sale

- **Status:** Blocked by `OQ-009`, `OQ-007`, `OQ-008`, `OQ-010`, `OQ-019`
- **Actor:** Role authorized by the future reversal policy
- **Preconditions:** An eligible sale exists and the accepted time/status/payment rules permit the requested reversal.
- **Trigger:** Actor submits void/refund intent, amount/items, and reason.
- **Main flow:** Not accepted. It must eventually authorize, validate eligibility, create explicit reversal/refund records, reverse payment state as applicable, create compensating inventory movements, update sale lifecycle, and commit atomically.
- **Alternative flows:** Full versus partial, pre-settlement void versus refund, non-restockable return, manager approval—each requires an explicit decision.
- **Error cases:** Already reversed; beyond time limit; excessive quantity/amount; payment provider failure; stock disposition unknown; forbidden role; duplicate request; concurrent reversal.
- **Business rules:** Never delete or edit the original completed sale/ledger rows to simulate a reversal.
- **Authorization:** Exact role/approval matrix is unresolved.
- **Expected result:** No implementation until rules are accepted; later, one traceable compensating lifecycle.
- **Acceptance criteria:** Must be written after `OQ-009` closes and include money, payment, stock, history, audit, idempotency, and concurrency tests.

## 6. Analytics and forecasting

### UC-AN-001 — View sales and inventory analytics

- **Status:** Blocked by `OQ-011`, `OQ-016`; framework ready after analytics definitions close
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` within the accepted analytics scope
- **Preconditions:** Actor has access to requested branch or aggregate; relevant operational data exists or an explicit empty state can be returned.
- **Trigger:** Actor opens dashboard or changes period/scope.
- **Main flow:**
  1. API validates canonical scope/period selector.
  2. It derives authorized branches and canonical period boundaries.
  3. It calculates/loads only metric definitions from `docs/ANALYTICS.md`.
  4. It returns values with metric version, period, timezone, scope, completeness, and null reasons.
  5. UI presents numbers/charts plus accessible textual/empty/partial/stale states.
- **Alternative flows:** Organization aggregate uses only authorized branches; snapshot is served when valid; insufficient history returns explicit status rather than fabricated zero/trend.
- **Error cases:** Invalid/non-comparable period; inaccessible branch; missing timezone decision; stale/incompatible snapshot; calculation failure; database timeout.
- **Business rules:** No OpenRouter call occurs. No formula is defined in UI/API code outside the analytics contract.
- **Authorization:** `OWNER`/`ADMIN` have organization-wide analytics, `BRANCH_MANAGER` assigned-branch analytics, `INVENTORY_STAFF` inventory-relevant analytics only, and `CASHIER` none. Cost/margin visibility remains limited to data expressly permitted for the role.
- **Expected result:** Reproducible, correctly scoped deterministic analytics or an explicit unavailable state.
- **Acceptance criteria:** Fixed-fixture formula tests; period boundary tests; cross-tenant/branch aggregation tests; zero/partial/insufficient cases; accessible responsive chart alternatives.

### UC-AN-002 — View forecast and reorder recommendation

- **Status:** Blocked by `OQ-007`, `OQ-010`, `OQ-011`, `OQ-012`, `OQ-021`, `OQ-023`
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` within the accepted forecast/reorder scope
- **Preconditions:** Forecasting V1 and input definitions are accepted; actor has scope access.
- **Trigger:** Actor opens forecast/replenishment view.
- **Main flow:** Resolve scope/horizon; load accepted history/current/incoming data; calculate versioned forecast; apply deterministic reorder formula; return estimate, recommendation, inputs, data status, and limitations.
- **Alternative flows:** Cold start/insufficient history returns baseline or no recommendation exactly as `OQ-012` decides; product/category/branch aggregation discloses grain.
- **Error cases:** Missing/incomplete data; invalid horizon; inactive product; unavailable lead time; negative stock; stale forecast; calculation failure.
- **Business rules:** OpenRouter does not produce values. Recommendation does not automatically create a purchase order. Model/version and uncertainty/data status are visible.
- **Authorization:** `OWNER`/`ADMIN` may access organization-wide forecast/reorder results; `BRANCH_MANAGER`/`INVENTORY_STAFF` are limited to assigned branches; `CASHIER` has no access. Cost-sensitive inputs are filtered by permission.
- **Expected result:** A reproducible system-calculated estimate/recommendation or explicit insufficient-data result.
- **Acceptance criteria:** Backtest fixture; named baseline comparison; deterministic repeat; no-data/zero-demand cases; formula input traceability; authorization tests.

## 7. Scheduled AI insights

### UC-AI-001 — Generate a scheduled AI insight

- **Status:** Cadences accepted; blocked in execution detail by `OQ-011`, `OQ-016`, `OQ-017`, `OQ-018`
- **Actor:** System scheduler/job
- **Preconditions:** A due report identity exists; deterministic metrics for the period can be computed or marked insufficient; provider configuration is available for an attempt.
- **Trigger:** Production EventBridge schedule or an authorized operational replay mechanism triggers the job.
- **Main flow:**
  1. Job claims the unique organization/branch-period-cadence identity idempotently.
  2. Analytics creates/loads a versioned aggregate snapshot.
  3. The job validates that the snapshot contains only permitted aggregate fields.
  4. It calls OpenRouter with a versioned prompt and bounded timeout.
  5. It validates/sanitizes the response as display content.
  6. It persists insight, snapshot link, provider/model/prompt provenance, and success state.
- **Alternative flows:** Insufficient data produces a deterministic no-insight/limited-insight state according to policy; safe retry resumes one logical report; catch-up generates missed periods in bounded order.
- **Error cases:** Duplicate trigger; snapshot failure; prohibited field detected; missing secret/model; timeout/rate limit/provider error; malformed output; database failure after provider success.
- **Business rules:** Dashboard traffic never triggers this use case. Provider failure never blocks POS, inventory, purchasing, or analytics. No personal/raw transaction data is sent. AI does not calculate.
- **Authorization:** System job uses least-privilege application identity and explicit tenant/report scope; operational replay needs an authorized admin path if provided.
- **Expected result:** One persisted successful insight or a safe failure/insufficient status with retry metadata; never duplicate uncontrolled provider calls.
- **Acceptance criteria:** Idempotency; duplicate trigger; timeout/retry; prohibited-data validator; snapshot provenance; failure isolation; secret-safe logs; four cadence fixtures.

### UC-AI-002 — View a persisted AI insight

- **Status:** Ready after UC-AI-001 decisions close
- **Actor:** Authorized analytics viewer
- **Preconditions:** Actor may access the insight's organization/branch scope.
- **Trigger:** Actor opens an insight/dashboard panel.
- **Main flow:** API returns the latest applicable persisted report and metadata; UI shows content, period, generated time, data status, and freshness.
- **Alternative flows:** No report, failed latest attempt, insufficient data, or stale last success each has a distinct state; deterministic analytics remain linked/available.
- **Error cases:** Inaccessible scope; malformed stored content; report/snapshot version mismatch; database unavailable. No on-demand OpenRouter call is made as fallback.
- **Business rules:** Numerical truth remains the analytics snapshot. UI must label AI text as summary and avoid presenting it as a guarantee.
- **Authorization:** `OWNER`/`ADMIN` may access organization-wide summaries and `BRANCH_MANAGER` assigned-branch summaries; `INVENTORY_STAFF` and `CASHIER` have no access.
- **Expected result:** Safe cached insight display or explicit unavailable/stale state.
- **Acceptance criteria:** Zero provider calls on reads; branch/tenant isolation; stale/failure UI; metadata visible; content cannot inject active HTML/script.

## 8. Branch transfer and branch price override

### UC-INV-003 — Transfer stock between branches

- **Status:** Blocked by `OQ-013`; do not implement from the example ledger types
- **Actor:** Future authorized inventory role
- **Preconditions/trigger/main flow:** Not accepted. Must define requested, approved, dispatched/in-transit, received, rejected/cancelled, loss/damage, and ownership states if included.
- **Alternative/error cases:** Partial receipt, concurrent cancellation, source shortage, destination mismatch, different actors, and in-transit stock all require explicit rules.
- **Business rules:** A transfer cannot be modeled as two unrelated manual adjustments.
- **Authorization:** Must cover both source and destination branches and role delegation.
- **Expected result:** No MVP behavior until `OQ-013` is accepted.
- **Acceptance criteria:** To be added with the decision.

### UC-CAT-002 — Override product price by branch

- **Status:** Blocked by `OQ-014`
- **Actor:** Future authorized pricing role
- **Preconditions/trigger/main flow:** Not accepted.
- **Alternative/error cases:** Effective dates, fallback to organization price, overlapping overrides, receipt snapshot, and actor permission require explicit rules.
- **Business rules:** Until accepted, product selling price is organization-level and no branch override table/API/UI is implied.
- **Authorization:** A future branch-price-override feature requires its own accepted scope/authorization decision; the current RBAC baseline does not authorize an unimplemented feature.
- **Expected result:** No implementation until accepted.
- **Acceptance criteria:** To be added with the decision.
