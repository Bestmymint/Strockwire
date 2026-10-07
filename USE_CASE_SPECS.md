# StockWise Use Case Specifications

| Field | Value |
| --- | --- |
| Status | Behavioral Source of Truth; Architecture Freeze v1 with explicit blockers |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-09-25 |

## 1. How to use this document

This document owns user- and system-visible behavior, including alternative flows and failures. Product scope is in `BUILD_SPEC.md`; exact HTTP shapes are in `docs/contracts/API.md`; data invariants are in `docs/architecture/DATABASE.md`; formulas are in `docs/contracts/ANALYTICS.md`.

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

- **Status:** Implemented by P2-M3-T01
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
- **Preconditions:** The verified user has either a persisted first-onboarding record for replay or no first-onboarding record and zero organization memberships. A pending invitation without a membership does not block the flow.
- **Trigger:** The user submits the onboarding form.
- **Main flow:**
  1. The API strictly validates required display name, organization name, and initial branch name plus optional profile/branch phone and branch address, applying the accepted boundary-trim/null rules.
  2. It derives the authenticated user from the opaque session, computes the internal SHA-256 canonical-request hash, locks that user row, and re-evaluates provenance and every membership status inside the transaction.
  3. For an eligible new flow, it replaces submitted profile values, creates the organization, creates the user's `OWNER` membership, creates the first branch with server-owned code `MAIN`, and creates the per-user provenance row atomically.
  4. It returns the safe organization/branch/owner context with `nextStep = app`; the browser navigates to the minimal `/app` holding route.
- **Alternative flows:** An identical canonical request with existing provenance returns HTTP `200` and the stored logical result without mutations. A pending invitation alone does not block onboarding. Joining through an accepted membership remains UC-IAM-006 rather than this endpoint.
- **Error cases:** Invalid/missing/unknown fields; `409 ALREADY_ONBOARDED` for different payload after provenance; `409 ALREADY_HAS_ORGANIZATION_ACCESS` for membership without provenance; transaction failure; concurrent different submission.
- **Business rules:** Required text is boundary-trimmed/nonblank; optional text is boundary-trimmed and blank becomes `NULL`; internal whitespace/Unicode form are preserved. The client supplies no actor, role, organization, branch, code, permission, or onboarding identity. `OWNER` is server-assigned and organization-wide, so no branch assignment is created. Profile photo, date of birth, gender, tax ID, company registration number, organization website/logo, and billing details are not MVP onboarding fields.
- **Authorization:** Authenticated incomplete account; cannot alter another account or organization.
- **Expected result:** A consistent user/organization/branch context is established, or nothing is partially created.
- **Acceptance criteria:** Atomicity, normalization, replay, concurrency, provenance, tenant-integrity, authenticated-actor, fixed-`MAIN`, no-owner-assignment, response-leakage, and frontend-navigation tests pass.

### UC-IAM-005 — Switch active branch

- **Status:** Implemented by P2-M3-T02
- **Actor:** Authenticated organization member
- **Preconditions:** The user has access to at least one active branch.
- **Trigger:** The user chooses a branch from the branch switcher or an authorized organization aggregate.
- **Main flow:**
  1. The client fetches `GET /me/access-context` and resolves only active effective access.
  2. It validates the `/app` organization/branch query candidates against that fresh response.
  3. Missing or revoked branch context falls back to the first accessible branch ordered by code; one organization is automatic and several require a chooser.
  4. With no accessible organization, the client enters first setup only when the same response reports server-derived first-organization onboarding eligibility; otherwise it renders the safe no-access state.
  5. Before switching, the UI cancels and removes the previous `["branch-scoped", organizationId, branchId, ...]` TanStack Query prefix, then replaces the URL.
  6. Every later branch-scoped API request still revalidates current membership, assignment, ownership, status, and permission server-side under that action's rules. An inactive branch is excluded from active navigation/new operations, but a retained active assignment may still authorize historical read-only access (`ADR-020`).
- **Alternative flows:** `OWNER`/`ADMIN` see all active organization branches; branch-only roles see active assigned branches only. An organization with no effective branch shows a safe no-branch state.
- **Error cases:** Branch inactive; access revoked; branch from another organization; stale cached selection; network failure. The UI falls back to an allowed selection and shows a safe message.
- **Business rules:** Selection is URL-only navigation context, not authorization. It is never persisted in the database, session, cookie, local storage, or session storage. First-organization eligibility is server-derived from durable membership/provenance and is not authorization proof for creation. One user can access multiple branches without separate accounts.
- **Authorization:** Active organization/branch membership and action permission.
- **Expected result:** The user sees only data from the selected authorized scope.
- **Acceptance criteria:** Cross-branch/tenant tests; revoked access takes effect server-side; cached queries do not display previous-branch data as current.

### UC-IAM-006 — Manage membership and branch assignment

- **Status:** Implemented by P2-M3-T03
- **Actor:** Owner or authorized administrator
- **Preconditions:** Actor has membership-management permission in the organization.
- **Trigger:** Actor invites/adds a member, changes role/branch assignment, or deactivates membership.
- **Main flow:** Validate canonical target email, role, and full desired branch scope; derive the actor and organization from trusted server state; verify grant authority; issue/reissue, revoke, list, or mutate access; persist bounded issuer/revoker/source/access-event provenance; and return a safe management view. Acceptance locks the organization/invitation, verifies the authenticated canonical email, revalidates active same-tenant branches, and atomically creates the membership, assignments, source provenance, acceptance event/scope snapshot, and invitation consumption.
- **Alternative flows:** An existing user signs in as the invited verified email; a new user registers and verifies that email, then reopens the link. Reissue always creates a fresh token and marks the prior open row `REPLACED`. A same accepted user may replay the accepted token and receive the current logical membership without mutation. Deactivation retains assignments and sessions but removes effective access; reactivation requires an explicit full desired role/scope.
- **Error cases:** Existing active/inactive membership; invalid/inactive/cross-tenant branch scope; role escalation; last active owner; stale `updatedAt`; wrong email; unknown, expired, revoked, or replaced invitation; provider failure; acceptance/reissue/revoke/concurrent-update races.
- **Business rules:** Invitations are email-bound, hash-only opaque tokens that expire in seven days and are single-use for state creation. Organization-wide roles reject branch scope; branch roles require at least one unique active same-organization branch. Membership edits/reactivation are full replacements. Organization-row serialization preserves one active owner. Historical assignment/provenance rows are retained, while `OQ-019` still governs any future generic audit system.
- **Authorization:** `OWNER` manages owners and OWNER-only ownership actions; `OWNER`/`ADMIN` manage non-owner memberships. No user may grant permissions they do not control, and at least one OWNER must remain.
- **Expected result:** Membership accurately reflects the accepted role and branch scope without orphaning governance.
- **Acceptance criteria:** Horizontal/vertical escalation, duplicate/replay, provider compensation, cross-tenant provenance, optimistic/concurrent mutation, last-owner, session-retention, access-context deauthorization, pagination, and token-leakage tests pass.

### UC-IAM-007 — Verify an email/password account

- **Status:** Implemented by P2-M2-T03
- **Actor:** Registered email/password user
- **Preconditions:** Registration may have created an active unverified account; account existence is not public information.
- **Trigger:** The user requests/resends verification or submits the opaque token from the delivered link.
- **Main flow:** A syntactically valid resend consumes the independent per-email limiter before lookup. For an eligible active unverified account, the API locks the user, replaces the prior open token, stores only the fresh 32-byte token's SHA-256 hash with 24-hour expiry, and asks the provider abstraction to deliver it. Completion hashes the submitted token and atomically consumes it while setting `emailVerifiedAt`.
- **Alternative flows:** The resend endpoint is also initial issuance. Missing, verified, or disabled accounts and provider failure return the same generic `202`; provider failure conditionally revokes the just-issued token. Concurrent resend leaves one open token, and concurrent completion succeeds at most once.
- **Error cases:** Malformed email/token; expired, consumed, revoked, replaced, or random token; provider/database failure; exhausted limiter. Raw token/hash/provider details never enter public errors or logs.
- **Business rules:** Three syntactically valid resend requests per canonical email per fixed 15-minute process-local window; attempt four returns `429` and deterministic `Retry-After`. Counting is eligibility/provider independent and uses a SHA-256-derived key. This does not resolve `OQ-020`.
- **Authorization:** Public, account-safe endpoints with no organization/branch privilege.
- **Expected result:** An eligible account becomes verified exactly once, or the public response remains non-disclosing.
- **Acceptance criteria:** Hash-only storage, 24-hour expiry, replacement, provider compensation, replay/expiry/random/concurrency, limiter, and leakage tests pass.

### UC-IAM-008 — Recover an email/password credential

- **Status:** Implemented by P2-M2-T03
- **Actor:** Email/password user who cannot use the current password
- **Preconditions:** Account may or may not exist; only an active verified account is eligible for delivery.
- **Trigger:** The user requests recovery and later submits the opaque token with an exact-policy new password.
- **Main flow:** A syntactically valid request consumes its independent per-email limiter before lookup. An eligible account receives a fresh hash-only 30-minute token after row-serialized replacement. Completion rejects invalid token state before Argon2, hashes the exact 15–128-code-point password with the centralized hasher, then atomically consumes the token, updates the password, and revokes all user sessions.
- **Alternative flows:** Existing, missing, unverified, disabled, non-delivered, and provider-failed requests return the same generic `202`; provider failure conditionally revokes the issued token. Completion creates no session and does not log the user in.
- **Error cases:** Malformed email/token/password; expired, consumed, revoked, replaced, or random token; provider/database/Argon2 failure; exhausted request limiter. Transaction failure preserves prior password, token, and sessions.
- **Business rules:** Recovery request uses the same three-per-15-minute SHA-256-derived canonical-email contract as resend. Reset completion has no MVP limiter; distributed/IP/global/provider controls remain in `OQ-020`.
- **Authorization:** Public account-safe request/completion endpoints.
- **Expected result:** One valid token changes the password and invalidates every prior session, without revealing account existence.
- **Acceptance criteria:** Generic responses, hash-only 30-minute token, exact password policy, pre-Argon2 rejection, atomic reset/session revocation, replay/concurrency/provider/rollback/leakage tests pass.

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

- **Status:** Implemented by P3-M1-T03; cost/valuation remains excluded from Product and belongs to implemented Branch/Product state under `ADR-026`
- **Actor:** Authorized owner/admin/inventory staff
- **Preconditions:** Actor has catalog permission in the organization; referenced category is accessible and active as required.
- **Trigger:** Actor submits product details.
- **Main flow:**
  1. Validate the accepted base price, immutable base unit, name, SKU, barcode, and optional category; normalize SKU and barcode exactly as `ADR-022` requires.
  2. Derive organization from trusted context.
  3. Verify category belongs to that organization.
  4. Enforce organization-scoped SKU and optional barcode uniqueness.
  5. Create/update current catalog data.
  6. Return a safe product representation.
- **Alternative flows:** Deactivate/reactivate a product; omit optional barcode/category; explicitly reassign to an active category or null. Unit is immutable after creation. Direct detail and authorized `includeInactive=true` lists retain inactive visibility. An unrelated edit may preserve the Product's current inactive Category.
- **Error cases:** Invalid or excess-scale base price/quantity; fractional integer-only quantity; unsupported unit; duplicate SKU/barcode; inactive/cross-tenant category; stale update (`PRODUCT_STALE`); product referenced by history; database failure.
- **Business rules:** Product is organization-level with one base price shared by every branch; no branch-price override exists in MVP. Base price accepts at most four decimal places and is rejected rather than rounded. Product has no authoritative cost, average-cost, COGS, or valuation field; implemented cost state is Branch/Product-owned under `ADR-026`. Updating catalog data never rewrites historical sale/receipt snapshots.
- **Authorization:** Product create/edit is allowed to `OWNER`, `ADMIN`, `BRANCH_MANAGER`, and `INVENTORY_STAFF` in their allowed scope; product lifecycle excludes `INVENTORY_STAFF`. Branch-scoped roles supply an active assigned `branchId` candidate that the API re-resolves; `OWNER`/`ADMIN` may use organization scope.
- **Expected result:** One valid organization product is stored without cross-tenant references.
- **Acceptance criteria:** Validation, uniqueness, tenant, immutable-history, and unauthorized-role tests pass.

`UC-CAT-002` is already assigned to the existing branch-price-override question. Category management therefore uses the next stable ID without renumbering existing use cases.

### UC-CAT-003 — Manage categories

- **Status:** Implemented by P3-M1-T03
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` in allowed scope
- **Preconditions:** The actor is authenticated in an active organization and has category-management permission.
- **Trigger:** The actor creates, updates, or deactivates an organization category.
- **Main flow:**
  1. The API derives the organization from trusted membership and validates the requested fields.
  2. It stores a trimmed display name and enforces the accepted normalized category identity key within the organization.
  3. For update/deactivation, it loads the category inside the same organization and checks current state.
  4. It creates or updates/deactivates the category while preserving valid product references and history.
  5. It returns the current category representation.
- **Alternative flows:** Products may remain uncategorized; an inactive category may be reactivated. Direct detail and authorized `includeInactive=true` lists retain inactive visibility. Explicit product reassignment to another active category or null occurs through product editing only.
- **Error cases:** Invalid/missing name; duplicate normalized key; category from another organization; unauthorized role; stale update (`CATEGORY_STALE`); attempted assignment of an inactive category; database failure.
- **Business rules:** Category is flat and organization-scoped. It is never hard-deleted or merged in MVP. Deactivation preserves product references, does not deactivate products, and never silently reassigns them; inactive categories cannot receive new assignments.
- **Authorization:** Create/edit follows catalog permission; deactivate/reactivate is limited to `OWNER`, `ADMIN`, and `BRANCH_MANAGER`. Branch-scoped roles supply an active assigned `branchId` candidate that the API re-resolves; `OWNER`/`ADMIN` may use organization scope.
- **Expected result:** One valid organization category is created or safely updated/deactivated, or no mutation occurs.
- **Acceptance criteria:** Tenant, permission, accepted normalization/duplicate, product-reference, deactivation/history, stale-update, and failure tests pass.

### UC-INV-001 — View branch stock and inventory history

- **Status:** Implemented inventory foundation; factual availability is accepted by
  `ADR-029`. `ADR-030` accepts fixed coverage-based low/normal/overstock
  classification for the later inventory analytics view; stockout risk remains
  blocked pending a separate risk/safety-stock policy.
- **Actor:** Authorized branch user or organization-level viewer
- **Preconditions:** Actor has access to the requested branch or authorized aggregate.
- **Trigger:** Actor opens inventory list/product history.
- **Main flow:**
  1. API validates scope, pagination, filters, and sorting.
  2. It returns current balances for accessible branch/product records.
  3. For history, it returns ledger movements in stable chronological order with source/actor context permitted to the role.
  4. UI distinguishes no balance record (quantity zero), a persisted zero balance,
     and unavailable data.
- **Alternative flows:** Organization view returns separate/aggregated branch data only when authorized; inactive products can be included by explicit filter. Branch deactivation preserves authorized read-only inventory balance/history access: `OWNER`/`ADMIN` retain organization-wide reads, and other roles with inventory-read permission may retain access through an existing active, non-revoked assignment. Removing/revoking that assignment removes branch-scoped historical access. Active navigation and new operational mutations remain unavailable for an inactive branch (`ADR-020`).
- **Error cases:** Invalid cursor/filter; inaccessible branch/product; stale page cursor; database unavailable. Do not leak another tenant's product or movement.
- **Business rules:** Balance is a projection; ledger explains changes. This
  operational inventory view does not emit the planned analytics classification.
  Current zero stock is factual, never a stockout-risk prediction.
- **Authorization:** Branch inventory-read permission or organization-wide permission.
- **Expected result:** Actor sees consistent balance and traceable movements for allowed scope only.
- **Acceptance criteria:** Pagination stability; tenant/branch isolation; balance-ledger fixture reconciliation; empty/error states; no N+1 access pattern.

### UC-INV-002 — Adjust branch stock

- **Status:** Ready after P3-M2-T02/T03 persistence/query foundations; quantity
  validation follows `ADR-022` and signed-ledger/idempotency rules follow `ADR-024`.
- **Actor:** Authenticated `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or
  `INVENTORY_STAFF` in trusted branch scope
- **Preconditions:** Product and branch are `ACTIVE`, belong to the same
  organization, and the actor has `inventory.adjust`; branch-scoped actors have
  an effective active assignment.
- **Trigger:** Actor submits an opaque `Idempotency-Key`, product ID, signed decimal
  delta, reason, and optional note.
- **Main flow:**
  1. Validate the signed delta against the immutable Product unit, reason/note rules,
     and trusted scope.
  2. Claim/check the organization-scoped idempotency identity and canonical request.
  3. Establish and pessimistically serialize the authoritative branch/product balance.
  4. Reject a resulting negative quantity with `INSUFFICIENT_STOCK` and no mutation.
  5. Update the balance and append exactly one `MANUAL_ADJUSTMENT` ledger movement
     with actor/context in the same database transaction.
  6. Return the resulting balance and movement reference, or the original logical
     result for an identical idempotent replay.
- **Alternative flows:** A first positive movement lazily creates the balance projection.
  A first negative movement fails without leaving a balance row. A wrong adjustment
  uses a signed compensating `CORRECTION` movement, not an edit to history.
- **Error cases:** Zero/invalid/excess-scale delta; non-integral integer-unit delta;
  missing/invalid reason; blank `OTHER` note; forbidden role; cross-tenant product;
  inactive product/branch; `INSUFFICIENT_STOCK`; `IDEMPOTENCY_CONFLICT`; database failure.
- **Business rules:** No direct balance overwrite or ledger deletion/edit. `STOCK_COUNT`,
  `DAMAGE`, `LOSS`, `FOUND`, `CORRECTION`, and `OTHER` are the accepted reasons;
  only `OTHER` requires a nonblank note; a blank optional note becomes null. There is no dual-approval workflow and no
  negative-stock override. InventoryTransaction is the bounded immutable domain
  provenance record; `OQ-019` remains open for generic audit logging.
- **Authorization:** Explicit branch stock-adjust permission; view permission alone is insufficient.
- **Expected result:** Exactly one traceable movement and matching balance change, or no change.
- **Acceptance criteria:** Atomicity, concurrency, duplicate, negative-stock, permission, tenant, and reconciliation tests pass.

## 4. Suppliers and purchasing

### UC-SUP-001 — Manage suppliers

- **Status:** Implemented by P4-M1-T02
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` in allowed scope
- **Preconditions:** The actor is authenticated in an active organization and has supplier-management permission.
- **Trigger:** The actor creates, updates, or deactivates an organization supplier.
- **Main flow:**
  1. The API derives the organization from trusted membership and validates accepted supplier fields.
  2. It applies the bounded Supplier contract: name plus optional contact name, email, phone, and address; duplicates are allowed.
  3. For update/deactivation, it loads the supplier within the same organization and verifies current state.
  4. It creates or updates/deactivates the supplier while retaining all Purchase Order and receipt references.
  5. It returns the current supplier representation.
- **Alternative flows:** OWNER/ADMIN lifecycle commands reactivate an inactive Supplier; inactive suppliers remain readable in historical Purchase Orders. Merge and replacement are excluded.
- **Error cases:** Invalid/missing fields; cross-tenant supplier; unauthorized role; attempted unsafe deletion of a referenced supplier; database failure.
- **Business rules:** Supplier is organization-scoped. A supplier referenced by purchasing history must not be hard-deleted or rewritten to alter historical Purchase Orders/receipts. Supplier CRUD is not part of P3-M1-T01.
- **Authorization:** Supplier create/edit is allowed to `OWNER`, `ADMIN`, `BRANCH_MANAGER`, and `INVENTORY_STAFF`; the branch-scoped roles need an active assignment but receive organization-wide Supplier access. Only `OWNER`/`ADMIN` may deactivate/reactivate.
- **Expected result:** One valid organization supplier is created or safely updated/deactivated, or no mutation occurs.
- **Acceptance criteria:** Tenant, permission, accepted duplicate/normalization, stale-update, deactivation/history, unsafe-delete, and failure tests pass.

### UC-PUR-001 — Create or edit a purchase order

- **Status:** Planned; lifecycle and costing contract accepted by `ADR-026`; product quantity validation follows `ADR-022`
- **Actor:** Authorized inventory/purchasing user
- **Preconditions:** Supplier, products, and target branch are active and belong to the same organization. An inactive Supplier blocks a new PO or DRAFT Supplier selection; a later-inactive Supplier does not prevent receipt of its already ORDERED PO.
- **Trigger:** Actor saves a new purchase order or edits an editable one.
- **Main flow:** Validate trusted branch/supplier/products, one unique Product line per PO, positive accepted quantities, expected unit costs, and THB-only values; create a server-referenced `DRAFT` with snapshots; allow only `DRAFT` edits; atomically transition `DRAFT` to `ORDERED` or `CANCELLED`; then freeze Supplier, Branch, lines, quantities, expected costs, and commercial snapshots.
- **Alternative flows:** An `ORDERED` PO may transition only to `RECEIVED` through receiving or to `CANCELLED`; `RECEIVED` and `CANCELLED` are terminal.
- **Error cases:** Empty/duplicate Product lines; invalid quantity/cost; cross-tenant supplier/product/branch; inactive creation target; non-editable/terminal state; stale update; reference conflict; database failure.
- **Business rules:** Purchase order targets one branch and does not move stock. Historical line snapshots survive catalog changes. Human-readable PO references are server-generated, immutable, and unique within Organization in the PO namespace.
- **Authorization:** Purchasing-write permission for target branch.
- **Expected result:** One consistent branch purchase order without inventory movement until receiving.
- **Acceptance criteria:** Tenant constraints; state/validation tests; no stock change on order creation; decimal behavior; immutable state enforcement.

### UC-PUR-002 — Receive a purchase order into branch stock

- **Status:** Receipt persistence and atomic service implemented by P4-M3-T01; authenticated receive-command HTTP/API exposure implemented by P4-M3-T02. The receipt, cost, and atomicity contract follows `ADR-026`, quantity validation follows `ADR-022`, and no-negative stock follows `ADR-024`.
- **Actor:** Authorized receiving/inventory user
- **Preconditions:** The PO is `ORDERED`, targets the trusted active branch, has no completed receipt, and every referenced Product is active. A later-inactive Supplier does not block this receipt.
- **Trigger:** Actor submits receipt actual unit costs, bounded document-level Input VAT snapshots where applicable, and an idempotency key; quantities are not client-entered.
- **Main flow:**
  1. Validate request and authorization.
  2. Lock/protect the purchase-order receive state and required balances.
  3. Derive one receipt item per PO line with exactly its frozen ordered quantity; reject any partial, over, short, duplicate, or no-PO receipt intent.
  4. Create the single immutable completed receipt and receipt items.
  5. Append one positive `PURCHASE_RECEIVE` ledger entry per receipt item with direct purchasing provenance.
  6. Update inventory balances and the Branch/Product moving weighted-average cost state.
  7. Transition the PO to `RECEIVED`.
  8. Commit everything and return the receipt.
- **Alternative flows:** An identical retry returns the original receipt; concurrent requests serialize to one logical receipt. Supplier returns, receipt correction, and receipt reversal are future scope, not alternatives.
- **Error cases:** Non-ORDERED/cancelled/received order; existing receipt; inactive Product/Branch; product mismatch; forbidden branch; duplicate idempotency key with different payload; invalid THB cost/Input VAT snapshot; transaction/deadlock failure.
- **Business rules:** Receipt, receipt-level idempotency, receipt-item snapshots, ledger, balance, cost, and order status are one transaction. The current manual-adjustment idempotency row is not copied per receipt item; receiving needs receipt-level identity plus unique receipt-item-to-ledger linkage. Before a Branch/Product basis is known, valuation/COGS for uncosted stock is unavailable; the first authoritative receipt initializes the basis for all then-on-hand quantity without fabricating or backfilling historical cost. Completed receipts are immutable and have no MVP correction/reversal path.
- **Authorization:** Receiving permission at the target branch.
- **Expected result:** One durable receipt and exactly matching stock/cost changes, or full rollback.
- **Acceptance criteria:** Failure injection at each step; duplicate/concurrent receiving tests; balance-ledger consistency; cross-tenant rejection; historical snapshots verified.

## 5. POS and sales

### UC-SALE-001 — Complete POS checkout

- **Status:** Implemented by P5-M2; cost snapshots follow `ADR-026`, quantity validation follows `ADR-022`, and no-negative stock follows `ADR-024`.
- **Actor:** Authorized owner, admin, branch manager, or cashier; inventory staff cannot sell.
- **Preconditions:** Actor has checkout permission for an active branch; transient cart has at least one active same-organization Product; Organization sales VAT configuration is not `UNCONFIGURED`.
- **Trigger:** Actor submits unique Product lines with quantities/expected prices, optional authorized whole-Sale discount, CASH or manually confirmed TRANSFER intent, and one idempotency key.
- **Main flow:**
  1. API validates strict decimal-string/request shape and re-resolves actor, Organization, active Branch, membership/assignment, checkout permission, and discount permission.
  2. Inside one transaction, service claims/resolves Organization-scoped checkout idempotency and locks/reads authoritative Organization VAT configuration.
  3. Server canonicalizes unique lines, reloads active Products and `basePrice`, and rejects any `expectedUnitPrice` mismatch.
  4. Server calculates THB subtotal, optional manager-or-higher AMOUNT/PERCENT discount, VAT-inclusive Output VAT where registered, grand total, and deterministic largest-remainder line allocations with Product-ID tie-break.
  5. It acquires shared Branch/Product inventory locks in sorted Product-ID order, locks balances/cost states, and enforces no-negative stock, payment, monetary-allocation, and UNKNOWN/KNOWN cost rules.
  6. It atomically creates the completed-by-existence Sale, immutable SaleItems, exactly one Payment, negative `SALE` inventory movements, balances, cost-state changes, COGS snapshots, and idempotency result.
  7. It commits and returns the immutable `SALE-<UUID>` Sale-backed receipt; no separate Sales Receipt is created.
- **Alternative flows:** Same key and semantically identical intent returns the original logical Sale with `200`; changed intent conflicts. CASH records tender/change. TRANSFER records manual confirmation and an optional bounded reference. UNKNOWN-cost stock may sell with null unit cost/COGS whether remaining quantity is positive or zero.
- **Error cases:** Empty/duplicate/invalid cart; invalid or inactive Organization/Branch/Product; unconfigured VAT; expected-price change; unauthorized/invalid discount; invalid payment/tender/reference; excess Decimal scale; insufficient stock; idempotency conflict; deadlock/serialization failure; database failure.
- **Business rules:** Cart is transient; no Draft Sale/reservation exists. Sale existence means successful atomic completion and the initial model has no Sale status. Price/VAT/totals/stock/actor are server-authoritative. Line allocations and Payment reconcile exactly to Sale totals. NOT_REGISTERED taxable amounts are null and Output VAT is zero. UNKNOWN cost never becomes zero or receives historical backfill. No Customer/CRM data is collected. LLM and analytics availability are irrelevant.
- **Authorization:** `OWNER`, `ADMIN`, assigned `BRANCH_MANAGER`, and assigned `CASHIER` may checkout; only owner/admin/assigned branch manager may discount; inventory staff cannot sell. Request IDs never prove tenant/branch access.
- **Expected result:** Exactly one immutable, internally consistent Sale with one Payment and matching inventory/cost effects, or no operational mutation.
- **Acceptance criteria:** Server price/VAT/total/allocation, discount authority, cash/transfer, atomic rollback, UNKNOWN/KNOWN cost, concurrency/oversell, idempotency, tenant/branch, Decimal, receipt, and provider-independence tests pass.

### UC-SALE-002 — View sales history, sale details, and receipt

- **Status:** Implemented by P5-M3; receipt/reference and immutable monetary content follow `ADR-027`.
- **Actor:** Cashier, manager, admin, or owner with relevant read permission
- **Preconditions:** At least authenticated access; requested scope is allowed.
- **Trigger:** Actor searches/browses sales or opens a sale/receipt.
- **Main flow:** Validate filters and scope; query paginated branch sales; load one allowed sale with immutable line/payment snapshots; render a browser-printable receipt.
- **Alternative flows:** `CASHIER` sees assigned-branch sales history as required for cashier operations; `OWNER`/`ADMIN` may query organization-wide history and `BRANCH_MANAGER` assigned-branch history.
- **Error cases:** Invalid range/cursor; inaccessible sale; revoked branch; missing historical optional product; database failure. Inaccessible and nonexistent records use safe behavior.
- **Business rules:** Historical names/prices/costs/VAT/discount/payment come from Sale snapshots, not current Product, Organization VAT, or actor/Branch names. Receipt is a projection of Sale/SaleItems/Payment, not a separate aggregate, and never exposes COGS. Internal history never exposes cost to a role without permission. P5-M4-T02 adds the derived refund summary and linked detail accepted by `ADR-028` without mutating the original Sale or receipt.
- **Authorization:** Sales-read/receipt permission at resource branch; cost/margin fields need separate permission.
- **Expected result:** Accurate, stable historical representation scoped to actor.
- **Acceptance criteria:** Snapshot stability after catalog change; pagination/filter tests; cost-field authorization; cross-tenant and inaccessible-branch tests; printable responsive view.

### UC-SALE-003 — Refund a sale

- **Status:** Implemented by P5-M4-T02 under `ADR-028`. VOID is not a V1 operation. Original Sales follow `ADR-027`, cost follows `ADR-026`, and stock follows `ADR-024`.
- **Actor:** `OWNER`, `ADMIN`, or an assigned `BRANCH_MANAGER`; CASHIER and INVENTORY_STAFF cannot create refunds.
- **Preconditions:** The immutable original Sale belongs to the trusted Organization and an active authorized Branch, has one confirmed CASH or TRANSFER Payment, and at least one SaleItem has refundable quantity. There is no time cutoff. Current Product inactivity does not invalidate historical refund eligibility.
- **Trigger:** Actor submits a required idempotency key, one or more unique original SaleItem IDs with positive refund quantity and a same-unit restock quantity from zero through the refund quantity, a required reason, and—when the original payment was TRANSFER—a manual refund-transfer reference.
- **Main flow:**
  1. Validate strict quantity, reason, idempotency, and transfer-reference input; authenticate and re-resolve Organization/Branch authorization.
  2. In one transaction, serialize the Organization refund idempotency identity, revalidate the candidate active Branch scope, then lock/load the original Sale and require its persisted Organization/Branch to match that authorized scope.
  3. Load immutable original SaleItem/Payment snapshots and prior refunds; calculate remaining refundable quantity and reject any cumulative excess.
  4. Derive line net, discount, gross, VAT, taxable, and refund total from cumulative historical allocations with exact Decimal arithmetic; never consult current Product price or current VAT settings.
  5. Derive refund cost only for restocked quantity from the original SaleItem cost snapshot; UNKNOWN stays null.
  6. Acquire the shared Branch/Product inventory locks for positive restock quantities in sorted Product-ID order and lock balances/cost states.
  7. Create immutable `SaleRefund`, `SaleRefundItem`, and one confirmed `RefundPayment`; append one positive `SALE_REFUND_RETURN` movement per restocked item and update balance/cost state.
  8. Persist the idempotency result and commit all effects; return the linked refund. Any failure rolls back everything.
- **Alternative flows:** Full refund is the cumulative state where every SaleItem reaches its sold quantity. Partial and fractional-quantity refunds may occur sequentially. A refund item may return all, some, or none of its refunded quantity to sellable inventory; V1 does not support a later restock-only operation for an already refunded quantity. An identical idempotent retry returns the existing refund.
- **Error cases:** Empty/duplicate items; zero, negative, excess-scale, non-integral integer-unit, or over-remaining quantity; restock above refund quantity; zero total refund; inaccessible/cross-tenant Sale; route Branch mismatch; inactive Branch; fully refunded Sale; forbidden role; missing/invalid TRANSFER refund reference; idempotency conflict; concurrent over-refund; database failure.
- **Business rules:** Original Sale, SaleItems, Payment, `SALE` movements, price/VAT/discount/cost snapshots, COGS, and original browser receipt are immutable. Refund records are immutable and cannot be edited/deleted/refunded. Monetary reversal uses refunded quantity; COGS and inventory effects use restocked quantity. No VOID, approval chain, same-day rule, gateway, legal credit note, or generic `OQ-019` audit system is introduced. The refund header's actor, membership, display snapshot, reason, UTC timestamp, reference, and item/payment/ledger links provide bounded operational auditability.
- **Authorization:** Refund create is `OWNER`, `ADMIN`, or assigned `BRANCH_MANAGER` in the original active Branch. Refund view matches Sales-history scope (`OWNER`, `ADMIN`, assigned `BRANCH_MANAGER`, assigned `CASHIER`). Refund cost view matches Sales-cost scope (`OWNER`, `ADMIN`, assigned `BRANCH_MANAGER`). INVENTORY_STAFF has no refund permission.
- **Expected result:** Exactly one immutable, linked, internally reconciled refund with one confirmed payment and optional same-branch stock/cost compensation, or no mutation.
- **Acceptance criteria:** Full/partial/fractional and sequential-refund money reconciliation; matching payment; optional restock; KNOWN/UNKNOWN cost transitions; authorization/tenant/branch isolation; original-history immutability; idempotency; concurrency; atomic rollback; list/detail presentation; and E2E tests pass.

## 6. Analytics and forecasting

### UC-AN-001 — View sales and inventory analytics

- **Status:** Metric/time contract accepted under `ADR-029`; analytics runtime implemented in Phase 6
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` within the accepted analytics scope
- **Preconditions:** Actor has access to requested branch or aggregate; relevant operational data exists or an explicit empty state can be returned.
- **Trigger:** Actor opens dashboard or changes period/scope.
- **Main flow:**
  1. API validates required date-only `from`/`to`, granularity, and candidate scope.
  2. It derives authorized Branches and converts Organization-local calendar boundaries
     to half-open UTC instants under IANA/DST rules.
  3. At one source cutoff/consistent read snapshot, it calculates only Accepted metric
     definitions from normalized authoritative records in `docs/contracts/ANALYTICS.md`.
  4. It returns `analytics-v1`, local/UTC period bounds, reporting timezone, included
     Branch scope, source cutoff, completeness/cost coverage, values, and null reasons.
  5. UI presents numbers/charts plus accessible textual/empty/partial/stale states.
- **Alternative flows:** Organization aggregate uses only authorized branches; snapshot is served when valid; insufficient history returns explicit status rather than fabricated zero/trend.
- **Error cases:** Invalid/unaligned/over-366-day/non-comparable period; invalid IANA timezone state; inaccessible Branch; stale/incompatible snapshot; calculation failure; database timeout.
- **Business rules:** Sale, refund, receipt, and inventory facts use their own persisted
  event times. Financial refund and restock quantities remain distinct. UNKNOWN cost
  produces explicit unavailable cost/profit/value rather than zero. No OpenRouter call
  occurs, and no formula is redefined in UI/API code.
- **Authorization:** `OWNER`/`ADMIN` have Organization-wide analytics (including inactive
  Branch history), `BRANCH_MANAGER` assigned-active-Branch business/inventory analytics,
  `INVENTORY_STAFF` assigned-active-Branch inventory-relevant non-cost analytics, and
  `CASHIER` none. Cost/profit/inventory value additionally require `SALES_COST_VIEW`.
- **Expected result:** Reproducible, correctly scoped deterministic analytics or an explicit unavailable state.
- **Acceptance criteria:** Fixed-fixture formula tests; period boundary tests; cross-tenant/branch aggregation tests; zero/partial/insufficient cases; accessible responsive chart alternatives.

### UC-AN-002 — View forecast and reorder recommendation

- **Status:** Forecasting V1's internal Branch/Product calculation is implemented
  by P6-M4-T02 under `ADR-031`; internal advisory Reorder V1 is implemented by
  P6-M4-T03 under `ADR-032`. The combined Forecast/Reorder API/UI flow is
  implemented by P6-M4-T04 in `ca8509a1b54af66b3b3bdf3d3af75fdd72ae2448`.
  Analytics time follows `ADR-029`, quantity follows `ADR-022`, and no-negative
  stock follows `ADR-024`.
- **Actor:** `OWNER`, `ADMIN`, `BRANCH_MANAGER`, or `INVENTORY_STAFF` within the accepted forecast/reorder scope
- **Preconditions:** The actor has scope access and supplies a bounded lead-time
  planning input. Internal recommendation logic follows `ADR-032`; user-facing
  access is exposed by the authenticated P6-M4-T04 API/UI.
- **Trigger:** Actor opens forecast/replenishment view.
- **Main flow:** Resolve scope/horizon; load accepted history/current/incoming data; calculate versioned forecast; apply deterministic reorder formula; return estimate, recommendation, inputs, data status, and limitations.
- **Alternative flows:** New/insufficient Branch/Product history returns
  `INSUFFICIENT_DATA`; inactive Product returns `INACTIVE_PRODUCT`; eligible
  all-zero history yields zero forecast. Reorder unavailable behavior follows
  `ADR-032`; product/category aggregation remains outside V1.
- **Error cases:** Missing/incomplete data; invalid horizon; inactive product; unavailable lead time; negative stock; stale forecast; calculation failure.
- **Business rules:** OpenRouter does not produce values. Recommendation does not automatically create a purchase order. Model/version and uncertainty/data status are visible.
- **Authorization:** `OWNER`/`ADMIN` may access organization-wide forecast/reorder results; `BRANCH_MANAGER`/`INVENTORY_STAFF` are limited to assigned branches; `CASHIER` has no access. Cost-sensitive inputs are filtered by permission.
- **Expected result:** A reproducible system-calculated estimate/recommendation or explicit insufficient-data result.
- **Acceptance criteria:** Backtest fixture; named baseline comparison; deterministic repeat; no-data/zero-demand cases; formula input traceability; authorization tests.

## 7. Scheduled AI insights

### UC-AI-001 — Generate a scheduled AI insight

- **Status:** Analytics periods accepted by `ADR-029`; V1 schedule/provider policy
  accepted by `ADR-033`. P7-M2-T03 implements claim, generation, and persistence;
  P7-M3-T01 implements due-period orchestration. Runtime triggering and replay
  remain unimplemented. Forecasting V1 is
  implemented internally by P6-M4-T02 but is not a required AI input.
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

- **Status:** Policy accepted by `ADR-033`; persisted read-only delivery (API and dashboard UI) is complete through Milestone 7.3. Phase 7 and P7-M4 are COMPLETE with the explicit accepted MT-L04 verification limitation; PRE-CLOUD READY YES; Phase 8 NOT STARTED; runtime scheduler triggering and replay remain unimplemented.
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

- **Status:** Deferred from MVP by `ADR-025`.
- **MVP behavior:** None. No transfer schema, API, UI, permission, lifecycle, ledger-source, or idempotency contract exists.
- **Future direction:** `SEND → IN_TRANSIT → RECEIVE → RECEIVED` with exact quantity and no partial/discrepancy workflow is non-binding guidance only. It must be re-reviewed and accepted before StockWise resumes this use case.
- **Expected result:** Stock transfer remains broader/full future scope without affecting current inventory behavior.

### UC-CAT-002 — Override product price by branch

- **Status:** Out of MVP scope by `ADR-022`.
- **Business rules:** Every branch uses the Product's organization-level base price. No branch override table, API, UI, effective-date rule, or pricing permission exists in MVP. SaleItems snapshot the actual unit price used at sale time.
