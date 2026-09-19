# StockWise REST API Contract

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1 contract; implementation verified through P5-M3; refund API accepted for P5-M4-T02 |
| Base path | `/api/v1` |
| Style | JSON REST |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-09-19 |

## 1. Scope and authority

This document is the Source of Truth for planned HTTP resources, methods, request/response semantics, validation, errors, authentication requirements, and authorization scope.

It is not an OpenAPI file and does not imply that any endpoint exists. When implementation begins, an OpenAPI 3.1 contract may be generated/maintained from these accepted semantics, but it must not answer a blocking `OQ-*` question silently.

## 2. Contract status

- **Planned:** behavior is accepted, though implementation prerequisites may remain.
- **Blocked:** endpoint shape or behavior depends on unresolved product/architecture rules and must not be implemented as a stable contract.
- **Future:** not part of the current MVP.

## 3. Global HTTP conventions

### 3.1 Media type and encoding

- Request and response bodies use UTF-8 JSON with `Content-Type: application/json` unless an accepted asset endpoint specifies otherwise.
- Timestamps use ISO 8601 UTC instants.
- Calendar period responses also include the reporting IANA timezone.
- Money, price, cost, tax, discounts, and precise quantities are serialized as canonical decimal strings.
- IDs are opaque strings. Clients must not infer ordering/type from an ID.
- Unknown request fields should be rejected for security-sensitive writes unless a compatibility policy explicitly allows them.

### 3.2 Success envelope

Single resource:

```json
{
  "data": {},
  "meta": {
    "requestId": "opaque-request-id"
  }
}
```

Collection:

```json
{
  "data": [],
  "meta": {
    "requestId": "opaque-request-id",
    "nextCursor": null
  }
}
```

Analytics responses add definition/period/scope metadata required by `docs/ANALYTICS.md`.

### 3.3 Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [
      {
        "field": "items.0.quantity",
        "code": "INVALID_VALUE",
        "message": "Quantity must be positive."
      }
    ],
    "requestId": "opaque-request-id"
  }
}
```

Rules:

- `code` is a stable machine-readable application code.
- `message` is safe for users and never contains a stack trace, SQL, secret, provider response, or inaccessible resource detail.
- `details` is optional and limited to safe validation/conflict context.
- Inaccessible cross-tenant resources use non-disclosing behavior.

### 3.4 Standard status and error mapping

| HTTP | Typical codes | Meaning |
| --- | --- | --- |
| `200` | — | Successful read/update/idempotent replay |
| `201` | — | Resource created |
| `204` | — | Successful action with no body, when used consistently |
| `400` | `VALIDATION_ERROR`, `INVALID_CURSOR` | Shape/semantic input invalid |
| `401` | `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED` | Identity not established |
| `403` | `FORBIDDEN` | Authenticated but action not permitted; use safely |
| `404` | `RESOURCE_NOT_FOUND` | Missing or intentionally undisclosed resource |
| `409` | `DUPLICATE_RESOURCE`, `STATE_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INSUFFICIENT_STOCK` | Uniqueness/current-state/business conflict |
| `413` | `VALIDATION_ERROR` | Request body exceeds the accepted transport limit |
| `422` | `BUSINESS_RULE_VIOLATION` | Valid JSON cannot satisfy an accepted domain rule; choose consistently during foundation |
| `429` | `RATE_LIMITED` | Abuse/budget limit reached |
| `500` | `INTERNAL_ERROR` | Unexpected safe server failure |
| `502`/`503`/`504` | `DEPENDENCY_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `DEPENDENCY_TIMEOUT` | External/internal dependency unavailable |

The project must choose one consistent boundary between `409` and `422` during API foundation without changing domain meaning.

### 3.5 Authentication

Browser authentication uses opaque server-side PostgreSQL sessions. The API sets the cryptographically random session token only in the `stockwise_session` HttpOnly, host-only, `Path=/`, `SameSite=Lax` cookie (`Secure` in production, not local HTTP); PostgreSQL stores only its cryptographic hash. The browser does not receive a JWT or refresh token and must not use `localStorage` or `sessionStorage` for authentication. Session idle and absolute timeouts are configurable (sliding 24 hours and fixed seven days as the baseline), and valid activity persists at most one touch per 15 minutes. The API validates expiry, revocation, and active verified account state for authentication; membership and authorization remain a separate server-resolved boundary.

This contract uses these semantic labels:

- **Public:** no authenticated state required, but abuse protection may apply.
- **Authenticated:** valid opaque server-side session required.
- **Organization-scoped:** authenticated membership plus role permission.
- **Branch-scoped:** authenticated organization membership/relationship, allowed branch, and role permission.
- **System:** least-privilege scheduled job or internal operational identity; not an end-user API.

Successful authentication rotates the session. Logout revokes the current session; an authenticated user can revoke all of their sessions. Password reset also revokes all user sessions. State-changing cookie-authenticated endpoints must receive implementation-time cross-site-request protections without creating a second credential transport.

### 3.6 Authorization and scoping

- Organization and branch path parameters select scope but never prove access.
- Server derives actor and validates membership, branch ownership, and permission on every protected request.
- Collection queries start from trusted scope; do not fetch globally and filter in memory.
- Organization aggregation includes only authorized branches and discloses its included scope.
- Price, totals, cost, user identity, and tenant ownership supplied by clients are never authoritative.

### 3.7 Validation

- Use Zod for params, query, headers, body, environment, and external response validation.
- Normalize email, SKU, and barcode exactly once by accepted rules.
- Reject invalid decimal syntax, non-finite numbers, ambiguous dates, unknown enums, excessive page size, and malformed cursors.
- Enforce length/size limits before logging or persistence.
- Database constraints remain mandatory for race-safe uniqueness.

### 3.8 Pagination, filtering, and sorting

- Use cursor pagination for potentially unbounded collections.
- Default and maximum page size are selected and tested during API foundation.
- Cursors are opaque, stable for the documented ordering, and validated.
- Default ordering includes a unique tie-breaker, normally `(createdAt desc, id desc)` or domain equivalent.
- Filters are allow-listed; arbitrary field/query injection is prohibited.

### 3.9 Idempotency

`Idempotency-Key` is required for checkout, purchase receiving, stock adjustment, and other retry-sensitive creates specified below.

- Key format/length is validated.
- The key is opaque, bounded, and not unnecessarily logged; persistence uses a
  deterministic hash and a canonical-request hash.
- Identity includes trusted tenant/branch and operation type.
- Same key + semantically same payload returns the same logical outcome.
- Same key + different payload returns `409 IDEMPOTENCY_CONFLICT`.
- Concurrent identical requests create at most one physical mutation. Inventory
  idempotency has no accepted expiry/retention window in MVP because its durable
  movement retains the necessary provenance.
- Concurrent requests with the same key create one logical operation.
- Retention duration is documented before production.

## 4. Shared resource representations

These are semantic fields, not final generated TypeScript types.

### `OrganizationSummary`

```json
{
  "id": "opaque-id",
  "name": "HCN Mart",
  "status": "active",
  "role": "OWNER"
}
```

### `BranchSummary`

```json
{
  "id": "opaque-id",
  "organizationId": "opaque-id",
  "code": "BKK-01",
  "name": "Latkrabang",
  "status": "active",
  "role": "BRANCH_MANAGER"
}
```

The accepted fixed RBAC roles are `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`. Each user has one organization role. `OWNER`/`ADMIN` have organization-wide branch access; the other roles require explicit branch assignments. Express enforces the capability and governance matrix in `BUILD_SPEC.md` section 8, including deny-by-default and the last-OWNER invariant. Resource status/lifecycle enums remain governed by their relevant open decisions.

### `Product`

```json
{
  "id": "opaque-id",
  "organizationId": "opaque-id",
  "categoryId": "opaque-id-or-null",
  "sku": "COKE-325",
  "barcode": "8850000000000",
  "name": "Coke 325 ml",
  "unit": "EA",
  "basePrice": "20.00",
  "status": "active",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

`basePrice` is the required organization-level configured amount shared by every branch. It is a non-negative decimal string with at most four fractional digits; inputs with greater scale are rejected rather than rounded. `ADR-027` makes it the server-authoritative SaleItem price and the final VAT-inclusive selling price when the Organization is sales-VAT REGISTERED. Product has no organization-wide cost/valuation field; Branch/Product cost state follows `ADR-026`. Branch overrides and manual checkout price overrides are out of MVP scope.

## 5. Health and service endpoints

| Method/path | Auth | Request | Response | Validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /health` | Public | None | `200 {"status":"ok"}` while the API process handles requests; does not check dependencies | No dependency detail | Implemented in foundation |
| `GET /ready` | Deployment/internal exposure policy | None | `200 {"status":"ready"}` when every configured required dependency is ready; `503 {"status":"not_ready"}` otherwise | `503 SERVICE_UNAVAILABLE`; no connection details | Implemented in foundation; exposure policy still depends on `OQ-015` |

Health endpoints must not return environment values, versions with known exploit value, SQL errors, credentials, or OpenRouter secrets.

At this foundation stage the API has no required external dependency, so the default readiness result is ready. Future resource-owning tasks must register only their required dependency checks and must preserve the same status-only response contract.

### 5.1 Local web development path

For local development only, the Next.js server proxies its same-origin
`GET /api/health` request to the Express `GET /health` operational probe and
forwards same-origin `/api/v1/:path*` requests to the matching Express REST
path. The browser never calls the Express loopback listener directly. This
keeps `/api/v1` as the StockWise business REST base path without enabling CORS.

The root `.env` supplies `STOCKWISE_API_PORT=3001` to the API and
`STOCKWISE_API_ORIGIN=http://127.0.0.1:3001` to the Next.js server; the browser
server runs on fixed port `3000`. Both values are validated by their owning
process and the origin value is server-only.

Express does not enable CORS for this development path. It listens on
`127.0.0.1` and emits no `Access-Control-Allow-Origin` header, including for a
direct request carrying `Origin: http://localhost:3000`. The Next.js proxy is
therefore the sole browser path for the health check and web authentication API
requests.

## 6. Identity and account endpoints

### Endpoint catalog

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/register` | Public | Email and password only | `202 Accepted` account-safe verification-next-step result; no session, token, organization, or branch created | Invalid input/rate limit/database or hashing failure; canonical-email duplicates receive the same public response as new accounts | Implemented by P2-M2-T01 |
| `POST /auth/login` | Public | Email and password only | `200`; sets a fresh opaque session cookie and returns only safe actor `id`, canonical `email`, and nullable `displayName` | Strict validation; generic invalid credentials for wrong/missing/unverified/disabled accounts; accepted login rate limit; safe database/hashing failure | Implemented by P2-M2-T02 |
| `POST /auth/logout` | Safely idempotent | None | `204`; revokes a valid current session and clears its cookie | Missing/malformed/unknown/expired/revoked state is idempotent; dependency failure does not clear cookie | Implemented by P2-M2-T03 |
| `POST /auth/logout-all` | Authenticated | None | `204`; revokes all sessions for current user and clears current cookie | Authentication/dependency/cross-site-request failure | Implemented by P2-M2-T03 |
| `POST /auth/verify-email` | Public | `{ "token": "opaque-token" }` | `200` verified result | Generic `400 INVALID_TOKEN` for expired/used/invalid/replaced token | Implemented by P2-M2-T03 |
| `POST /auth/verification-resend` | Public | `{ "email": "account@example.com" }` | Generic `202`; creates/replaces and delivers only for an eligible unverified account | Validation; accepted three-per-15-minute limit; provider failure remains non-disclosing | Implemented by P2-M2-T03 |
| `POST /auth/forgot-password` | Public | `{ "email": "account@example.com" }` | Generic `202`; creates/replaces and delivers only for an eligible account | Validation; accepted three-per-15-minute limit; provider failure remains non-disclosing | Implemented by P2-M2-T03 |
| `POST /auth/reset-password` | Public | `{ "token": "opaque-token", "newPassword": "exact-value" }` | `200` reset result; atomically consumes token, updates password, and revokes all sessions | Generic `400 INVALID_TOKEN`; password validation; safe dependency failure | Implemented by P2-M2-T03 |
| `GET /me` | Authenticated | None | Safe profile and onboarding status | Authentication required | Planned after identity foundation |
| `PATCH /me/profile` | Authenticated | Required display name; optional phone | Updated safe profile | Validation, stale/conflict | Planned after identity foundation |
| `GET /me/organizations` | Authenticated | Pagination if needed | Accessible organization summaries | Authentication required | Planned |
| `GET /me/access-context` | Authenticated | None | Safe active user/organization/role/effective-branch context plus first-organization onboarding eligibility | Authentication required | Implemented by P2-M3-T02; eligibility added by post-login routing fix |
| `GET /organizations/{organizationId}/branches` | Organization-scoped | Optional exact `includeInactive=true`; no pagination | Code-ascending accessible branch list | Invalid query/forbidden safely | Implemented by P2-M3-T02 |
| `POST /organizations/{organizationId}/branches` | `branch.manage` (`OWNER`/`ADMIN`) | Code, name, optional phone/address | `201` safe branch | Validation, forbidden, `BRANCH_CODE_CONFLICT` | Implemented by P2-M3-T02 |
| `PATCH /organizations/{organizationId}/branches/{branchId}` | `branch.manage` (`OWNER`/`ADMIN`) | Editable name/phone/address plus exact `expectedUpdatedAt` | Updated safe branch | Validation, safe not-found, `BRANCH_STALE` | Implemented by P2-M3-T02 |
| `POST /organizations/{organizationId}/branches/{branchId}/deactivate` | `branch.manage` (`OWNER`/`ADMIN`) | Exact `expectedUpdatedAt` | Inactive safe branch | Safe not-found, `BRANCH_STALE`, `LAST_ACTIVE_BRANCH` | Implemented by P2-M3-T02 |
| `POST /organizations/{organizationId}/branches/{branchId}/reactivate` | `branch.manage` (`OWNER`/`ADMIN`) | Exact `expectedUpdatedAt` | Active safe branch | Safe not-found, `BRANCH_STALE` | Implemented by P2-M3-T02 |

There are no Google OAuth endpoints in the MVP contract.

### Branch and access-context contract

Branch responses contain only `id`, `organizationId`, canonical immutable
`code`, `name`, nullable `phone`/`address`, `status`, and millisecond UTC
`updatedAt`. Create trims/uppercases code and trims other boundary text; blank
optional text becomes `null`. Branch code is 1–16 characters matching
`[A-Z0-9][A-Z0-9_-]*`. Duplicate names are allowed. Unknown fields, including
actor, role, permission, organization reassignment, or branch code in an edit,
fail strict validation.

`includeInactive` defaults false. Only `OWNER`/`ADMIN` may request true. They
list every organization branch; branch-only roles list active assigned branches
only and cannot expose inactive rows. All lists order by code ascending with ID
as a deterministic tie-breaker and are intentionally unpaginated for MVP.

Lifecycle commands are explicit and same-state commands are idempotent only
when `expectedUpdatedAt` still matches. `LAST_ACTIVE_BRANCH` is enforced inside
the serialized database transaction. Assignment rows are not changed by branch
lifecycle. All cookie-authenticated mutations use the accepted same-origin
request protection.

Access-context returns safe actor display data plus active organization
memberships, role, and effective active branches. It omits sessions, permission
arrays, assignments, inactive objects, credential data, and tokens. Clients may
use it to render navigation, never as proof that a later request is authorized.
It also returns `firstOrganizationOnboarding: { "eligible": boolean }` for the
authenticated user. `eligible` is true only when no onboarding provenance and
no organization membership row of any status exists; a pending invitation alone
does not block it. The value exposes no membership, invitation, or provenance
details and is not authorization proof for `POST /organizations`, which rechecks
eligibility transactionally.

### Registration contract

- Email uses the canonical surrounding-whitespace-trimmed lowercase policy.
- Password contains 15–128 Unicode code points. Its submitted value is not
  trimmed, Unicode-normalized, silently truncated, or subject to character-class
  composition rules; whitespace and Unicode are accepted. Breached-password
  screening is deferred.
- Password storage uses the PHC-format output from `argon2@0.45.1` Argon2id with
  `memoryCost=65536` KiB, `timeCost=3`, `parallelism=4`, and the library-generated
  random salt.
- A newly persisted user has `emailVerifiedAt = null` and `displayName = null`.
  P2-M2-T01 creates no verification-token record, sends no email, establishes no
  authenticated session, and creates no organization or branch.
- New and canonical-email duplicate attempts return the same generic `202
  Accepted` response and verification next step. PostgreSQL canonical-email
  uniqueness is the final concurrency boundary; Prisma/database uniqueness
  details are never returned or logged.
- P2-M2-T03 owns verification-token creation, resend, provider
  integration/delivery, and verification behavior.

New and duplicate registrations use this exact public success envelope; it
contains no user identifier, email, credential metadata, or indication that a
row was created:

```json
{
  "data": {
    "nextStep": "verify_email",
    "status": "accepted"
  },
  "meta": {
    "requestId": "opaque-request-id"
  }
}
```

`nextStep` states the required account lifecycle step. It does not claim that
P2-M2-T01 created a verification token or sent email; those actions remain
owned by P2-M2-T03.

The implementation does not perform an account-existence pre-read. Every valid,
permitted request follows the same Argon2id-and-create path until PostgreSQL
accepts the insert or reports the canonical-email uniqueness conflict. This is
the minimal database-authoritative race-safe path, not a synthetic timing delay.
Runtime and database scheduling can still vary, while distributed/high-cardinality
abuse and stronger production timing controls remain under `OQ-020`.

### Registration/login security requirements

- Do not return password hashes or credential metadata.
- Do not reveal account existence through materially different messages/timing where practical.
- Apply rate limiting and security telemetry without logging submitted email or password values.
- Do not return raw session, verification, reset, or invitation tokens in persisted resources, logs, or general response payloads.
- Verification, reset, and invitation delivery use the provider abstraction. Local/test adapters are non-delivery; production uses the Resend adapter.
- Forgot-password and resend responses are account-safe and non-disclosing. Verification and reset tokens are single-use and expiry-bound; successful reset revokes every user session.

### Login and authenticated-session contract

- Request validation accepts only `email` and `password`, rejects unknown
  fields, canonicalizes email with the registration policy, and preserves the
  password exactly without trimming, normalization, or truncation.
- Correct credentials require an `ACTIVE` user with non-null
  `emailVerifiedAt`. Wrong password, missing canonical account, disabled user,
  and unverified user all return `401 INVALID_CREDENTIALS` with the same public
  message. Missing accounts execute verification against one fixed valid dummy
  Argon2 PHC hash through the centralized verifier.
- Successful authentication generates a fresh 32-byte CSPRNG token and stores
  only its deterministic SHA-256 hash. The database session identifier and
  token hash are never serialized. A currently valid same-user incoming cookie
  session is revoked as `login_rotation` atomically with fresh-session creation.
- Initial idle expiry is login plus 24 hours and absolute expiry is login plus
  seven days by default. Valid authenticated requests persist a touch at most
  once per 15 minutes, setting idle expiry to
  `min(now + idle timeout, absolute expiry)`. Required touch failure, expiry,
  revocation, unknown token, disabled/unverified actor, and database failure all
  fail authentication closed.
- The login-only limiter processes five credential failures per canonical email
  per fixed 15-minute process-local window. Success is allowed before
  exhaustion and does not reset the active window. Subsequent attempts after
  five failures receive `429 RATE_LIMITED` and remaining-window `Retry-After`.
  Malformed requests do not create limiter keys. Distributed/IP-aware/global
  controls and proxy trust remain under `OQ-020`.

Successful login returns exactly this public shape (with `displayName` as a
string when already populated):

```json
{
  "data": {
    "user": {
      "id": "opaque-user-id",
      "email": "user@example.com",
      "displayName": null
    }
  },
  "meta": {
    "requestId": "opaque-request-id"
  }
}
```

It returns no session ID/hash, password data, membership, role, organization,
branch, permission, or authorization state. Organization/branch options belong
to later onboarding and access-management work.

### Logout and credential-lifecycle contract

- `POST /auth/logout` is safely idempotent for a missing, malformed, unknown,
  expired, or already revoked cookie. A syntactically valid token is hashed for
  lookup; a matching open session is revoked as `logout`. The cookie is cleared
  only after the revocation attempt succeeds. `POST /auth/logout-all` requires a
  valid authenticated context, revokes every open session for that actor as
  `logout_all`, and clears the current cookie. Both cookie-authenticated writes
  reject a cross-site Fetch Metadata signal or a mismatched supplied `Origin`;
  `SameSite=Lax` remains the primary browser cookie control.
- The cleared `stockwise_session` cookie retains `Path=/`, `HttpOnly`,
  `SameSite=Lax`, host-only scope, and production-only `Secure`, and adds
  `Max-Age=0` plus the epoch `Expires` value. Logout never returns a session ID,
  raw token, or token hash.
- Verification resend is also initial verification issuance. Eligible means an
  active, unverified account. Issuance uses a fresh 32-byte CSPRNG opaque token,
  stores only SHA-256, expires after 24 hours, and serializes replacement by
  locking the user row. Every prior open token is marked replaced before the new
  token is created. Completion conditionally consumes the active, unexpired
  token and sets `emailVerifiedAt` in one transaction; replay and concurrent
  duplicate completion produce one success at most.
- Forgot-password is eligible only for an active verified account. Issuance uses
  the same 32-byte/hash-only boundary, expires after 30 minutes, and serializes
  replacement through the user row. Completion validates token state before
  Argon2, then conditionally consumes the token, updates the accepted Argon2id
  PHC password hash/`passwordChangedAt`, and revokes every open user session as
  `password_reset` in one transaction. It does not create a session or log the
  user in.
- Verification-resend and forgot-password successes use exactly
  `202 {"data":{"status":"accepted"},"meta":{"requestId":"..."}}` for
  eligible, missing, already verified, disabled, non-delivered, and
  provider-failed outcomes. Provider failure conditionally revokes the just
  issued token; raw provider errors never enter the response. Verification
  completion returns `200` with `data.status = "verified"`; reset completion
  returns `200` with `data.status = "password_reset"`.
- Production uses Resend through the API-owned provider interface. Development
  uses a no-op non-delivery adapter and tests inject a deterministic recording
  adapter. The provider request has a ten-second timeout and no automatic retry;
  provider response bodies, message payloads, API keys, and complete sensitive
  links are not logged.

Verification resend and forgot-password use independent fixed-window limiters.
Each allows three syntactically valid requests per canonical email per 15
minutes, keys only a SHA-256 derivative, and consumes before account lookup and
provider work regardless of eligibility or delivery outcome. Attempt four and
later returns `429 RATE_LIMITED` with deterministic remaining-window
`Retry-After`; success does not reset the window. Malformed email creates no
entry. Reset completion has no separate MVP limiter and rejects malformed,
unknown, expired, revoked, replaced, or consumed tokens before Argon2. These are
narrow application-level exceptions only: all distributed/IP/global/provider,
proxy-trust, multi-instance, production DoS, and long-term telemetry behavior
remains open under `OQ-020`.

## 7. Organization, branch, and membership endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `POST /organizations` | Authenticated verified account; first-onboarding/replay rules below | Required display, organization, and initial branch names; optional profile/branch phone and branch address | `200`; initial creation or identical replay of safe user/organization/`MAIN` branch/OWNER context | Strict validation; `ALREADY_ONBOARDED`; `ALREADY_HAS_ORGANIZATION_ACCESS`; safe dependency failure | Implemented by P2-M3-T01 |
| `GET /organizations/{organizationId}` | Organization-scoped | None | Organization detail allowed to role | Safe not-found/forbidden | Planned |
| `PATCH /organizations/{organizationId}` | Organization admin | Editable fields | Updated organization | Validation/state/stale conflict | Blocked field/permission details |
| `POST /organizations/{organizationId}/branches` | `OWNER` or `ADMIN` | Code, name; optional phone/address | Created branch | Duplicate code, invalid state | Planned after identity foundation |
| `GET /organizations/{organizationId}/members` | `OWNER` or `ADMIN` | `includeInactive`, opaque cursor, limit | Safe member/user/role/status/configured branch scope page | Invalid cursor, forbidden | Implemented by P2-M3-T03 |
| `GET /organizations/{organizationId}/invitations` | `OWNER` or `ADMIN` | Opaque cursor, limit | Open invitation metadata/scope page; no token/hash | Invalid cursor, forbidden | Implemented by P2-M3-T03 |
| `POST /organizations/{organizationId}/invitations` | `OWNER` for OWNER; `OWNER`/`ADMIN` for non-owner | Exact email, role, full branch IDs | `201` safe invitation state | Existing membership, invalid scope, escalation, provider failure | Implemented by P2-M3-T03 |
| `POST /organizations/{organizationId}/invitations/{invitationId}/revoke` | Same delegation as target invitation | No body | Current safe invitation state | Accepted final state, forbidden | Implemented by P2-M3-T03 |
| `POST /invitations/accept` | Authenticated verified invited email | Exact opaque invitation token | Current membership plus replay flag | Generic invalid invitation, invalid current scope, existing membership | Implemented by P2-M3-T03 |
| `PATCH /organizations/{organizationId}/members/{membershipId}` | `OWNER` for OWNER changes; `OWNER`/`ADMIN` for non-owner | Exact role, full branch IDs, expected `updatedAt` | Updated safe membership | Last owner, escalation, stale/state/scope | Implemented by P2-M3-T03 |
| `POST /organizations/{organizationId}/members/{membershipId}/deactivate` | Same delegation as target membership | Expected `updatedAt` | Inactive safe membership | Last owner, stale, forbidden/not found | Implemented by P2-M3-T03 |
| `POST /organizations/{organizationId}/members/{membershipId}/reactivate` | Same delegation as desired/current role | Exact role, full branch IDs, expected `updatedAt` | Active safe membership | Escalation, stale/state/scope | Implemented by P2-M3-T03 |

No endpoint may accept an arbitrary `organizationId` in the body as ownership truth.

### Membership invitation and assignment contract

All request bodies are strict. Invitation create accepts exactly:

```json
{
  "email": "staff@example.com",
  "role": "CASHIER",
  "branchIds": ["opaque-branch-id"]
}
```

The API canonicalizes email. `OWNER` may issue any role; `ADMIN` may issue only
non-owner roles. `OWNER`/`ADMIN` invitations require `branchIds: []`.
`BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER` require at least one unique
active same-organization branch. Inactive or cross-tenant IDs return the same
safe `400 INVALID_BRANCH_SCOPE`. Any active/inactive membership for that
canonical email returns `409 MEMBERSHIP_ALREADY_EXISTS` without mutation.

Creating for the same organization/email always reissues: the prior open row is
terminal `REPLACED`, a new hash-only seven-day token row is created, and only the
new transient URL is delivered. Delivery failure conditionally revokes that row
and returns `503 INVITATION_DELIVERY_FAILED`. Explicit revoke is `POST` with no
body. Revoked and expired outcomes are safe/idempotent `200`; an accepted
invitation returns `409 INVITATION_FINALIZED`. `ADMIN` cannot revoke an OWNER
invitation.

Acceptance accepts exactly `{ "token": "opaque-token" }`. Malformed, unknown,
expired, revoked, replaced, wrong-email, or another-actor consumed tokens return
the generic `400 INVALID_INVITATION`. Invalid current branch scope returns `409
INVITATION_SCOPE_INVALID` and leaves the invitation unconsumed. Success returns
HTTP `200` with `{ membership, replayed }`. The first success atomically creates
the membership, assignments, source provenance, and bounded access event while
consuming the invitation. Replay by that same accepted user returns the linked
current membership with `replayed: true` and performs no mutation. A concurrent
membership winner returns `409 MEMBERSHIP_ALREADY_EXISTS` and terminalizes the
invitation so it cannot later mutate that membership.

Member PATCH/reactivate accept exactly:

```json
{
  "role": "BRANCH_MANAGER",
  "branchIds": ["opaque-branch-id"],
  "expectedUpdatedAt": "2026-08-24T18:00:00.000Z"
}
```

This is full replacement. PATCH requires an active membership; reactivation
requires an inactive membership unless the exact active desired state is an
idempotent no-op. Deactivate accepts only `expectedUpdatedAt`; matching-version
inactive deactivation is idempotent. Exact timestamp mismatch returns `409
MEMBERSHIP_STALE`. Organization-wide results inactivate configured assignments;
branch roles activate exactly the requested active scope. Deactivation retains
role, assignments, and sessions but subsequent server access-context and
authorization evaluation excludes the membership. Organization-row locking
enforces `409 LAST_ACTIVE_OWNER` under concurrent demotion/deactivation.

Member and open-invitation lists use ascending `(createdAt,id)` opaque cursors,
default limit 25, maximum 100. Member listing defaults to active rows and accepts
`includeInactive=true`. Responses omit sessions, permission internals, token
hashes/raw values, provider payloads, and persistence internals. Cross-tenant
resource identifiers use safe forbidden/not-found behavior without revealing
existence.

### First organization onboarding contract

`POST /organizations` is the one-time first-organization command, not a generic
organization creator. Its strict body accepts exactly:

```json
{
  "displayName": "Owner Name",
  "phone": "+66 1 234 5678",
  "organizationName": "HCN Mart",
  "branchName": "Latkrabang",
  "branchPhone": "+66 2 000 0000",
  "branchAddress": "1 Main Road"
}
```

The three name fields are required. Surrounding whitespace is trimmed and the
result must be nonblank. Optional strings are trimmed and omitted/blank values
persist as `NULL`. Internal whitespace and Unicode representation are preserved;
no Unicode normalization, case folding, phone transformation, or phone format is
introduced. The request never accepts actor, organization, membership, role,
branch, code, permission, onboarding, or idempotency-key state. The API derives
the actor from the verified opaque session and assigns initial branch code
`MAIN` plus role `OWNER` server-side.

The API hashes a deterministic serialization of the canonical six-field value,
including explicit `NULL` optionals, with SHA-256. The internal hash and a unique
per-user provenance record drive replay; neither is accepted or returned. With
no provenance, eligibility requires zero organization memberships regardless of
status. A pending invitation alone is not a membership and does not block the
command. Existing provenance plus the same hash is a non-mutating replay;
different hash returns `409 ALREADY_ONBOARDED`. Membership without provenance
returns `409 ALREADY_HAS_ORGANIZATION_ACCESS`. Both conflicts use the canonical
error envelope and mutate nothing.

Initial success and identical replay return HTTP `200`:

```json
{
  "data": {
    "user": {
      "id": "opaque-user-id",
      "displayName": "Owner Name",
      "phone": null
    },
    "organization": {
      "id": "opaque-organization-id",
      "name": "HCN Mart"
    },
    "branch": {
      "id": "opaque-branch-id",
      "name": "Latkrabang",
      "code": "MAIN",
      "phone": null,
      "address": null
    },
    "role": "OWNER",
    "nextStep": "app"
  },
  "meta": {
    "requestId": "opaque-request-id"
  }
}
```

The result contains no membership/provenance identifier, request hash, session
state, token, permission list, or database representation. The web client
navigates a successful result to `/app`, which is only the P2-M3-T01 completion
holding shell.

## 8. Catalog endpoints

All paths are organization-scoped. Every endpoint authenticates and re-resolves
the active membership and authorization context from PostgreSQL. `OWNER` and
`ADMIN` may omit `branchId`; if supplied it must identify an active branch in
the organization. Other roles must supply query `branchId=<uuid>` for an active
assigned branch. Missing context returns `400 BRANCH_CONTEXT_REQUIRED`; invalid,
inactive, cross-tenant, unassigned, or revoked context returns the same safe
`403 FORBIDDEN`.

| Method/path | Permission | Request | Status |
| --- | --- | --- | --- |
| `GET /organizations/{organizationId}/categories` | `catalog.view` | `branchId`, `limit`, `cursor`, `q`, `includeInactive` | Implemented by P3-M1-T03 |
| `POST /organizations/{organizationId}/categories` | `catalog.create-edit` | Strict name/optional description | Implemented by P3-M1-T03 |
| `GET /organizations/{organizationId}/categories/{categoryId}` | `catalog.view` | Optional `branchId` | Implemented by P3-M1-T03 |
| `PATCH /organizations/{organizationId}/categories/{categoryId}` | `catalog.create-edit` | Name/description plus exact `expectedUpdatedAt` | Implemented by P3-M1-T03 |
| `POST /organizations/{organizationId}/categories/{categoryId}/deactivate` | `catalog.deactivate` | Exact `expectedUpdatedAt` | Implemented by P3-M1-T03 |
| `POST /organizations/{organizationId}/categories/{categoryId}/reactivate` | `catalog.deactivate` | Exact `expectedUpdatedAt` | Implemented by P3-M1-T03 |
| `GET /organizations/{organizationId}/products` | `catalog.view` | `branchId`, `limit`, `cursor`, `q`, `categoryId`, `includeInactive` | Implemented by P3-M1-T03 |
| `POST /organizations/{organizationId}/products` | `catalog.create-edit` | Strict accepted Product fields | Implemented by P3-M1-T03 |
| `GET /organizations/{organizationId}/products/{productId}` | `catalog.view` | Optional `branchId` | Implemented by P3-M1-T03 |
| `PATCH /organizations/{organizationId}/products/{productId}` | `catalog.create-edit` | Mutable fields plus exact `expectedUpdatedAt`; unit excluded | Implemented by P3-M1-T03 |
| `POST /organizations/{organizationId}/products/{productId}/deactivate` | `catalog.deactivate` | Exact `expectedUpdatedAt` | Implemented by P3-M1-T03 |
| `POST /organizations/{organizationId}/products/{productId}/reactivate` | `catalog.deactivate` | Exact `expectedUpdatedAt` | Implemented by P3-M1-T03 |

Category create always starts `ACTIVE`. It accepts only `name` and optional
`description`; blank descriptions become `null`, and normalized identity is
server-derived. PATCH may change name/description on either lifecycle state and
requires at least one mutable field. Missing/cross-tenant detail is
`CATEGORY_NOT_FOUND`; normalized collisions are `CATEGORY_NAME_CONFLICT`; stale
writes are `CATEGORY_STALE`.

Product create always starts `ACTIVE` and accepts only name, description, SKU,
barcode, base-price decimal string, immutable unit, and optional category.
PATCH may change every listed field except unit, status, identity, ownership,
and timestamps. An omitted category preserves the relation; `null` removes it.
New category assignments require an active same-organization Category. An
unrelated edit may retain the Product's current inactive Category. Missing or
cross-tenant categories return `CATEGORY_NOT_FOUND`; inactive new assignments
return `CATEGORY_INACTIVE`. Duplicate SKU/barcode and stale writes return
`SKU_CONFLICT`, `BARCODE_CONFLICT`, and `PRODUCT_STALE`. Product responses always
serialize `basePrice` with exactly four fractional digits and never as a JSON
number.

Lifecycle commands are exact-version, idempotent when already in the desired
state, and never delete or cascade. Direct detail may return inactive records.
Lists default to active records. `includeInactive=true` requires either
`catalog.create-edit` or `catalog.deactivate`; view-only `CASHIER` is denied.

Lists use opaque keyset cursors ordered by immutable `(createdAt ASC, id ASC)`,
default limit 25, and maximum 100. Cursors are bound to normalized filters and
scope candidates; malformed or mismatched cursors return `INVALID_CURSOR`.
Category `q` applies normalized substring matching. Product `q` OR-matches
case-insensitive name substring, canonical SKU prefix, and exact trimmed
barcode. Product `categoryId` accepts a UUID or `uncategorized`; a missing or
cross-tenant filter UUID returns an empty page without disclosing existence.

SKU, barcode, base-price, unit, normalization, optimistic concurrency, and
same-tenant constraints follow `ADR-022`/`ADR-023`. Database uniqueness remains
authoritative under races. No catalog endpoint exposes cost, valuation, COGS,
stock, quantity, branch pricing, or hard deletion.

## 9. Inventory endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/branches/{branchId}/inventory` | Branch inventory read | Cursor, category/status filters | Product + current balance page | Invalid filter/cursor, forbidden branch | Implemented in P3-M2-T03; stock classification filters remain blocked `OQ-011` |
| `GET /organizations/{organizationId}/branches/{branchId}/inventory/{productId}` | Branch inventory read | None | Current balance and product summary | Safe not-found/cross-tenant | Implemented in P3-M2-T03 |
| `GET /organizations/{organizationId}/branches/{branchId}/inventory/{productId}/transactions` | Branch inventory read | Cursor, source/date filters | Stable ledger page | Invalid range/cursor, safe product not-found | Implemented in P3-M2-T03 |
| `POST /organizations/{organizationId}/branches/{branchId}/inventory/adjustments` | Branch stock adjust | `Idempotency-Key`; product, signed `delta`, reason, optional note | Movement + new balance | Invalid/zero/excess-scale delta, inactive/cross-tenant resource, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT` | Implemented in P3-M2-T04; `ADR-022`, `ADR-024` |

Adjustment request must not contain an authoritative resulting balance. The server
applies a signed delta within one PostgreSQL transaction after pessimistically
serializing the authoritative branch/product balance. A negative result returns
`409 INSUFFICIENT_STOCK` with no ledger/balance mutation. The exact header grammar
is 1–200 visible ASCII characters without spaces; only its SHA-256 hash is persisted.
New success returns `201`; an identical replay returns `200` and reconstructs the
original logical result. The accepted request and response shapes are:

```json
{
  "productId": "opaque-product-id",
  "delta": "-2.25",
  "reason": "DAMAGE",
  "note": "Damaged during handling"
}
```

```json
{
  "data": {
    "balance": { "quantity": "7.75" },
    "transaction": {
      "id": "opaque-movement-id",
      "delta": "-2.25",
      "source": "MANUAL_ADJUSTMENT",
      "reason": "DAMAGE",
      "note": "Damaged during handling",
      "occurredAt": "2026-08-30T12:00:00.000Z"
    }
  },
  "meta": { "requestId": "opaque-request-id" }
}
```

`STOCK_COUNT`, `DAMAGE`, `LOSS`, `FOUND`, `CORRECTION`, and `OTHER` are
accepted reasons. `OTHER` requires a nonblank note; other blank notes become null.
Inactive Branch/Product state returns `BRANCH_INACTIVE`/`PRODUCT_INACTIVE` at
`409`. The response never exposes idempotency hashes or membership provenance.

Stock transfer is **DEFERRED FROM MVP** by `ADR-025`. No transfer endpoint or future
endpoint contract is defined.

Inventory reads require a trusted concrete branch scope and `inventory.view`.
Branch-scoped roles require an active assignment; all five accepted roles may
read only branches they can effectively access. `OWNER`/`ADMIN` remain
organization-wide but must still select a concrete branch path. Branch
deactivation preserves authorized historical readability. Balance list `status`
is `ACTIVE` by default and accepts `INACTIVE` or
`ALL`; `categoryId` accepts a same-tenant UUID or `uncategorized`. Its opaque
cursor is bound to the organization, branch, and filters and orders products by
`(createdAt ASC, id ASC)`. The result includes every matching Product, even when
it has no persisted balance: `{ exists: false, quantity: "0", updatedAt: null }`
represents the accepted lazy zero without creating a row. Direct product detail
also includes inactive products and preserves this representation.

Transaction history is scoped to one branch/product and orders immutable ledger
rows by `(occurredAt ASC, id ASC)`, matching the chronological index. Its cursor
is bound to that scope plus the optional `source`, `occurredAfter`, and
`occurredBefore` ISO-8601 UTC filters. The current source allow-list is
`MANUAL_ADJUSTMENT` or `PURCHASE_RECEIVE`. Purchase-receive rows have null
adjustment reason/note and retain their direct receipt-item provenance internally.
History returns its movement ID, canonical decimal-string delta, source/reason/note,
timestamp, and minimal actor ID/display name. It never
returns idempotency-key hashes, canonical-request hashes, membership IDs, or
other internal provenance fields.

## 10. Supplier and purchasing endpoints

### Suppliers

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/suppliers` | Supplier view | Cursor/search/status | Suppliers | Invalid cursor/filter | Implemented by P4-M1-T02 |
| `POST /organizations/{organizationId}/suppliers` | Supplier create/edit | Bounded Supplier fields | Supplier | Validation | Implemented by P4-M1-T02 |
| `GET /organizations/{organizationId}/suppliers/{supplierId}` | Supplier view | None | Supplier | Safe not-found | Implemented by P4-M1-T02 |
| `PATCH /organizations/{organizationId}/suppliers/{supplierId}` | Supplier create/edit | Mutable bounded fields | Supplier | Validation/safe not-found | Implemented by P4-M1-T02 |
| `POST /organizations/{organizationId}/suppliers/{supplierId}/deactivate` | Supplier deactivate (`OWNER`/`ADMIN`) | Empty body | Supplier | Safe not-found | Implemented by P4-M1-T02 |
| `POST /organizations/{organizationId}/suppliers/{supplierId}/reactivate` | Supplier deactivate (`OWNER`/`ADMIN`) | Empty body | Supplier | Safe not-found | Implemented by P4-M1-T02 |

### Purchase orders and receipts

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/branches/{branchId}/purchase-orders` | Branch purchasing read | `cursor`, `limit`, `status`, `supplierId`, inclusive `orderDateFrom`/`orderDateTo` | Purchase order summaries | Invalid range/filter-bound cursor | Implemented by P4-M2-T02 |
| `POST /organizations/{organizationId}/branches/{branchId}/purchase-orders` | Branch purchasing write | Supplier, one line per Product, quantities, expected THB costs | Server-referenced `DRAFT` purchase order | Cross-tenant/inactive refs, invalid/duplicate lines/cost | Implemented by P4-M2-T02; `DRAFT` lifecycle follows `ADR-026`, quantity follows `ADR-022` |
| `GET /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}` | Branch purchasing read | None | Order and immutable item snapshots | Safe not-found | Implemented by P4-M2-T02 |
| `PATCH /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}` | Branch purchasing write | DRAFT field replacement or accepted state intent plus exact `expectedUpdatedAt` | Purchase order | Non-editable/stale/terminal-state conflict | Implemented by P4-M2-T02; lifecycle follows `ADR-026` |
| `POST /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}/receipts` | `OWNER`, `ADMIN`, assigned `BRANCH_MANAGER`, or assigned `INVENTORY_STAFF` for the persisted PO branch | Mandatory `Idempotency-Key`; actual THB costs keyed by PO item plus bounded document-level Input VAT snapshot; no received quantities | `201` completed Receipt; identical replay returns the same logical Receipt with `200` | Strict transport; ORDERED/exact frozen quantity/cost/VAT/idempotency/concurrency | Implemented by P4-M3-T02; `ADR-022`, `ADR-024`, and `ADR-026` |

Receipt persistence and the atomic receiving service are implemented by P4-M3-T01;
P4-M3-T02 exposes only that existing transaction through the command above. The
service derives every receipt quantity from the frozen ORDERED PO, creates at most
one immutable receipt, and does not expose a sequence of public endpoints for
separately creating a receipt and then mutating stock. Partial/over/short/multiple
receipt, receiving without a PO, supplier returns, and receipt correction/reversal
have no MVP endpoint. The route `branchId` is a validated candidate context only;
the service authorizes against the PO's persisted Branch.

The mandatory `Idempotency-Key` follows the existing printable ASCII 1–200-character
header contract. The API does not generate or replace the key. Within one
Organization, the same key and canonical receive intent replays the same logical
Receipt without another stock/cost movement; reuse for a different actual-cost or
VAT intent returns `409 IDEMPOTENCY_CONFLICT`. The same raw key is independently
namespaced in another Organization.

```json
{
  "actualCosts": [
    {
      "purchaseOrderItemId": "opaque-uuid",
      "actualUnitCost": "12.3400"
    }
  ],
  "vat": {
    "organizationVatRegistered": true,
    "inputVatRate": "7.000000",
    "inputVatAmount": "0.8638",
    "supplierTaxDocumentNumber": "TAX-100",
    "supplierTaxDocumentDate": "2026-09-02"
  }
}
```

`actualCosts` contains exactly one mapping for every frozen PO item. Item identity is
the stable `purchaseOrderItemId`; values are non-negative decimal strings at scale at
most four and are never interpreted as JavaScript `number`. Missing, duplicate,
extra, malformed, negative, or excess-scale mappings return `400 VALIDATION_ERROR`.
The body is strict and rejects client quantities, Branch/Supplier/Product overrides,
receipt identity/timestamps, balance/cost results, and PO status.

Because MVP Organization data has no authoritative VAT-registration master field, the
receiving command supplies an explicit receipt-time VAT-registration assertion.
The service validates and snapshots that assertion independently and includes it in
receipt-level idempotency; it is not inferred from VAT amounts or Supplier documents.
Rate and amount are both null or both present; a non-VAT-registered assertion cannot
carry them. Rate accepts a non-negative decimal string at scale at most six, amount at
scale at most four, document number is nullable/trimmed/nonblank up to 100 characters,
and document date is nullable valid `YYYY-MM-DD`. Invalid combinations return
`400 VALIDATION_ERROR`; the API performs no VAT calculation.

Successful responses use `{ "data": { "receipt": ... }, "meta": {
"requestId": ... } }`. Public Receipt fields are `id`, `organizationId`, `branchId`,
`purchaseOrderId`, `supplierId`, `reference`, `receivedAt`, `createdAt`,
`receivedByUserId`, the five bounded VAT snapshot fields, and immutable `items` with
`id`, `purchaseOrderItemId`, `productId`, SKU/name snapshots, server-derived
`receivedQuantity`, and four-place `actualUnitCost`. Internal membership identity,
idempotency/canonical hashes, lock material, and database metadata are not exposed.

Stable command failures include `401 AUTHENTICATION_REQUIRED`, `403 FORBIDDEN`,
`404 PURCHASE_ORDER_NOT_FOUND`, `409 BRANCH_INACTIVE`, `409 PRODUCT_INACTIVE`,
`409 PURCHASE_ORDER_STATE_CONFLICT`, `409 PURCHASE_ORDER_RECEIPT_INVALID`,
`409 IDEMPOTENCY_CONFLICT`, and `409 RECEIPT_REFERENCE_CONFLICT`. Unexpected storage
failures use the generic `500 INTERNAL_ERROR` envelope without SQL/Prisma details.

Purchase-order creation is server-authorized for the concrete active branch and
creates a THB-only `DRAFT` with a server-generated immutable PO reference.
Expected unit cost and quantity are decimal strings with at most four fractional
places; `EA`, `PACK`, and `BOX` quantities are integral. The server derives the
four-place `expectedTotal` from the submitted lines and persists product SKU/name
snapshots. Client totals and references are not accepted.

Lists sort by descending `(createdAt,id)` and use opaque cursors bound to the
organization, route branch, status, supplier, and inclusive order-date filters.
`status` defaults to `all`; every cursor reuse with different filters returns
`400 INVALID_CURSOR`. Detail and write access re-authorize the concrete persisted
branch, not client-provided scope.

PATCH accepts either one or more DRAFT fields (`branchId`, `supplierId`,
`orderDate`, nullable `expectedDate`, and full replacement `items`) or exactly
one lifecycle intent (`ORDERED` or `CANCELLED`), always with the exact
millisecond `expectedUpdatedAt`. It returns `409 PURCHASE_ORDER_STALE` for a
version mismatch. Only `DRAFT` may be edited. `DRAFT -> ORDERED`,
`DRAFT -> CANCELLED`, and `ORDERED -> CANCELLED` are accepted; `RECEIVED` and
`CANCELLED` are terminal. ORDERED state freezes branch, supplier, lines,
quantities, expected costs, and snapshots. Ordering revalidates the referenced
Supplier and Products, recalculates the expected total, and creates no receipt,
inventory transaction, stock movement, cost update, or VAT record.

## 11. POS and sales endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/sales-vat-profile` | `OWNER`, `ADMIN` | None | Authoritative Organization sales VAT profile | Safe not-found/forbidden | Implemented; P5-M2-T02 |
| `PATCH /organizations/{organizationId}/sales-vat-profile` | `OWNER`, `ADMIN` | Exact `expectedUpdatedAt`; status and conditional rate | Updated sales VAT profile | Invalid state/rate, stale version, safe not-found/forbidden | Implemented; P5-M2-T02 |
| `GET /organizations/{organizationId}/branches/{branchId}/pos/products` | Branch checkout | Query/barcode/cursor | Sellable product summaries with current server price/availability indicator | Invalid query, forbidden branch | Implemented; P5-M2-T02 |
| `POST /organizations/{organizationId}/branches/{branchId}/sales` | `OWNER`, `ADMIN`, assigned `BRANCH_MANAGER`, assigned `CASHIER` | Required `Idempotency-Key`; unique cart lines, optional authorized discount, CASH/TRANSFER intent | `201` completed Sale-backed receipt; exact replay `200` | VAT config, price, stock, payment, discount, idempotency, concurrency | Implemented; P5-M2-T02; `ADR-027` |
| `GET /organizations/{organizationId}/branches/{branchId}/sales` | `OWNER`, `ADMIN`, assigned `BRANCH_MANAGER`, assigned `CASHIER` | `cursor`, `limit`, absolute `createdAtFrom`/`createdAtTo`, `actorUserId`; no V1 refund-status filter | Historical Sale summaries; P5-M4 target adds derived refund state/amounts | Invalid query/range/cursor, safe forbidden | Implemented by P5-M3-T01; refund projection targeted by P5-M4-T02 |
| `GET /organizations/{organizationId}/branches/{branchId}/sales/{saleId}` | Branch sales read | None | Immutable Sale/line/payment/cost snapshots; P5-M4 target adds linked refunds and remaining quantities | Safe not-found/forbidden | Implemented by P5-M3-T01; refund projection targeted by P5-M4-T02 |
| `POST /organizations/{organizationId}/branches/{branchId}/sales/{saleId}/refunds` | `OWNER`, `ADMIN`, assigned `BRANCH_MANAGER` | Required `Idempotency-Key`; unique SaleItem quantities/restock quantities; required reason; conditional TRANSFER reference | `201` immutable linked SaleRefund; identical replay `200` | Historical allocation, cumulative quantity, payment, restock/cost, idempotency, concurrency | Planned for P5-M4-T02; `ADR-028`; no VOID endpoint |

Sales-history listing is ordered by `createdAt DESC, id DESC`. Its opaque, versioned
cursor is bound to the Organization, Branch, `createdAtFrom`, `createdAtTo`, and
`actorUserId` filter context and continues that two-field keyset; changing any path or
filter makes the cursor invalid. `limit` defaults to `25` and is bounded from `1` to
`100`. `createdAtFrom` is inclusive and `createdAtTo` exclusive; both accept only
RFC3339 absolute timestamps with an explicit offset or `Z`, and the former must be before
the latter. These filters do not define a business day or reporting timezone: `OQ-016`
remains unresolved. `actorUserId` is an exact UUID match against the persisted Sale actor
and remains constrained by the authorized Organization/Branch query. Summary and detail
values come only from immutable Sale/SaleItem/Payment snapshots. Cost/COGS fields appear
only to OWNER, ADMIN, and assigned BRANCH_MANAGER detail readers; they never appear in
Sale summaries or cashier/customer receipt data. Browser receipt printing uses the existing
Sale detail response as its immutable data source; this phase has no separate receipt API.

Sales VAT profile target representation:

```json
{
  "salesVatStatus": "REGISTERED",
  "salesVatRate": "7",
  "updatedAt": "2026-09-05T00:00:00.000Z"
}
```

`salesVatStatus` is `UNCONFIGURED`, `NOT_REGISTERED`, or `REGISTERED`.
`UNCONFIGURED` is an application configuration state, not a legal registration
classification, and blocks checkout. REGISTERED requires a positive rate below `100`;
the other statuses require `salesVatRate: null`. The configured rate is never
hardcoded. In MVP, every Product sold by a REGISTERED Organization is assumed subject
to this one rate; mixed/product-specific/exempt/zero-rated/multiple-rate tax behavior
is unsupported. The profile is Organization authority, not checkout input.

Conceptual `PATCH` request bodies are:

```json
{
  "expectedUpdatedAt": "2026-09-05T00:00:00.000Z",
  "salesVatStatus": "REGISTERED",
  "salesVatRate": "7"
}
```

or, for either non-rate state:

```json
{
  "expectedUpdatedAt": "2026-09-05T00:00:00.000Z",
  "salesVatStatus": "NOT_REGISTERED",
  "salesVatRate": null
}
```

The endpoint accepts only exact decimal strings for the rate, enforces the conditional
state/rate rules, and uses `expectedUpdatedAt` as an exact optimistic-concurrency
precondition. Existing and newly created Organizations start `UNCONFIGURED` with a
null rate until an authorized `OWNER` or `ADMIN` explicitly changes the profile.

Accepted CASH checkout request:

```json
{
  "items": [
    {
      "productId": "opaque-id",
      "quantity": "2",
      "expectedUnitPrice": "60.1234"
    }
  ],
  "discount": {
    "type": "PERCENT",
    "percent": "10",
    "reason": "Manager-approved opening promotion"
  },
  "payment": {
    "method": "CASH",
    "amountTendered": "200.00"
  }
}
```

Accepted TRANSFER payment alternative:

```json
{
  "method": "TRANSFER",
  "reference": "optional-bank-or-qr-reference"
}
```

Conceptual completed Sale/customer-receipt response data:

```json
{
  "id": "opaque-sale-id",
  "reference": "SALE-<uuid>",
  "organizationId": "opaque-organization-id",
  "branchId": "opaque-branch-id",
  "organizationNameSnapshot": "Example Store",
  "branchNameSnapshot": "Main Branch",
  "branchCodeSnapshot": "MAIN",
  "actorDisplayNameSnapshot": "Employee Name",
  "occurredAt": "2026-09-05T00:00:00.000Z",
  "currency": "THB",
  "items": [
    {
      "productId": "opaque-product-id",
      "skuSnapshot": "SKU-001",
      "nameSnapshot": "Product",
      "unitSnapshot": "EA",
      "quantity": "2",
      "unitPrice": "60.1234",
      "lineGross": "120.25",
      "lineDiscount": "12.03",
      "lineTaxable": "101.14",
      "lineOutputVat": "7.08",
      "lineNet": "108.22"
    }
  ],
  "subtotalAmount": "120.25",
  "discount": {
    "type": "PERCENT",
    "percent": "10",
    "reason": "Manager-approved opening promotion"
  },
  "discountAmount": "12.03",
  "salesVatStatusSnapshot": "REGISTERED",
  "vatRateSnapshot": "7",
  "taxableAmount": "101.14",
  "outputVatAmount": "7.08",
  "totalAmount": "108.22",
  "payment": {
    "method": "CASH",
    "amount": "108.22",
    "amountTendered": "200.00",
    "changeAmount": "91.78",
    "reference": null
  }
}
```

The actual response uses the standard success envelope. Customer money totals and
allocations serialize with exactly two fractional digits, accepted unit prices with
exactly four fractional digits, and quantity strings with no more than four fractional
digits. Request boundaries reject rather than round values that exceed their accepted
scale. A no-discount response uses a null discount descriptor and
`discountAmount: "0.00"` in the frozen resource contract. A NOT_REGISTERED response
uses null Sale/line taxable amounts and VAT-rate snapshot plus `"0.00"` Sale/line
Output VAT. It must not label Sale net as taxable base.

Rules:

- The transient cart is not persisted before checkout. Duplicate Product lines are
  rejected. Quantity follows `ADR-022`; `expectedUnitPrice` is an exact optimistic
  precondition only. The server reloads active Product and `basePrice`, rejects a
  mismatch with `409 PRICE_CHANGED`, and computes all authoritative values.
- Discount is optional and whole-Sale only. `AMOUNT` supplies `amount` with scale at
  most two; `PERCENT` supplies `percent` with scale at most four. Both require a
  trimmed nonblank reason of at most 200 characters and manager-or-higher authority.
  Amount is positive and less than subtotal; percent is positive and below `100`.
- CASH requires `amountTendered` with scale at most two and at least the server total.
  TRANSFER has no tender/change and may carry one trimmed reference up to 100
  characters. Payment amount is not client-authored; it equals the Sale total. No
  CARD, split, gateway, pending, offline, slip, OCR, or Payment-status input exists.
- Server applies optional discount before registered document-level VAT extraction.
  It uses exact Decimal arithmetic, `ROUND_HALF_UP` at accepted document/cost
  boundaries, and deterministic Product-ID-tied largest-remainder line allocation.
  Excess-scale inputs are rejected rather than rounded.
- First success returns `201`; same `Idempotency-Key` plus the same canonical trusted
  Organization/Branch/actor, sorted lines/quantities/expected prices, discount, and
  payment intent returns the original logical Sale/reference with `200`. Changed
  intent returns `409 IDEMPOTENCY_CONFLICT`. The key is printable ASCII 1–200
  characters and only its deterministic hash is persisted.
- Stable checkout conflicts include `PRICE_CHANGED`, `INSUFFICIENT_STOCK`,
  `IDEMPOTENCY_CONFLICT`, `VAT_CONFIGURATION_REQUIRED`, and safe active-resource/
  authorization conflicts. Validation covers decimal scale, discount, payment, and
  duplicate-line rules.
- Response uses immutable Sale/SaleItem/Payment snapshot values and reference
  `SALE-<UUID>`. It contains no Sale status, Customer/CRM data, or COGS in its customer
  receipt representation. Internal cost fields require a separate authorized history
  view later.
- OpenRouter is never called in checkout.

### Refund target contract

`ADR-028` resolves `OQ-009` with REFUND only. No `/void`, Sale mutation, standalone
refund-receipt, or refund-of-refund endpoint exists. P5-M4-T02 may implement the
accepted create command and extend existing history/detail projections; the contract
below does not claim that runtime implementation exists yet.

The create body is strict and has this conceptual shape:

```json
{
  "items": [
    {
      "saleItemId": "uuid",
      "quantity": "1",
      "restockQuantity": "1"
    }
  ],
  "reason": "Customer returned unopened item",
  "transferReference": null
}
```

Rules:

- `items` is nonempty with unique original SaleItem IDs. `quantity` is positive and
  `restockQuantity` is non-negative and no greater than `quantity`; both follow the
  original Product unit and four-place quantity boundary. The server rejects excess
  scale, non-integral integer units, and cumulative quantity above the original line.
- The route Organization/Branch/Sale are candidate scope only. The service authorizes
  against the original Sale's persisted Organization and active Branch. Current Product
  inactivity does not block a historical refund. Cross-branch returns are invalid.
- `reason` is trimmed, Unicode-preserving, nonblank, and 1–200 characters. There is no
  time cutoff or approval input. `OWNER`, `ADMIN`, and assigned `BRANCH_MANAGER` may
  create; CASHIER and INVENTORY_STAFF may not.
- Payment method is not client-selected; it must equal the original Payment method.
  CASH requires `transferReference: null`. TRANSFER requires a trimmed nonblank
  1–100-character manual confirmation reference. Refund amount is server-derived;
  clients cannot send price, total, discount, VAT, taxable, cost, or COGS values.
- Refund money uses the cumulative-target exact-decimal algorithm in `ADR-028` over
  original SaleItem net/discount/VAT snapshots. The operation total must be positive.
  Final line quantity absorbs remaining cents so cumulative values equal the original.
- Only positive `restockQuantity` appends a positive `SALE_REFUND_RETURN` movement and
  changes balance/cost state. Historical COGS uses original SaleItem cost and restocked
  quantity; UNKNOWN stays null. Original Sale/Payment/items/`SALE` movements remain
  immutable.
- `Idempotency-Key` is mandatory printable ASCII of 1–200 characters. Under the
  Organization-scoped `SALE_REFUND` namespace, same key plus canonical trusted
  Organization/Branch/actor, Sale, sorted item quantities, reason, derived payment
  method, and transfer reference returns the original logical refund with `200`.
  First success returns `201`; changed intent returns `409 IDEMPOTENCY_CONFLICT`.
- The command serializes the original Sale before cumulative validation, then acquires
  shared Branch/Product locks for restocked Products in sorted Product-ID order. Refund,
  items, one payment, optional ledger/balance/cost updates, and idempotency result are
  one transaction.

The safe response contains immutable refund `id`, `reference`, `organizationId`,
`branchId`, `saleId`, reason, actor display snapshot, `completedAt`, currency, exact
gross/discount/taxable/VAT/total strings, matching-method payment evidence, and items
with original SaleItem/Product identity, refund/restock quantities, and monetary
components. Cost basis/unit cost/COGS reversal appear only to OWNER, ADMIN, and assigned
BRANCH_MANAGER. Internal hashes, membership IDs, lock material, and database metadata
are never exposed.

Stable command failures include `401 AUTHENTICATION_REQUIRED`, `403 FORBIDDEN`, safe
`404 SALE_NOT_FOUND`, `409 BRANCH_INACTIVE`, `409 SALE_ALREADY_FULLY_REFUNDED`, `409
REFUND_QUANTITY_EXCEEDED`, `409 IDEMPOTENCY_CONFLICT`, and `400 VALIDATION_ERROR` for
invalid quantity/restock/reason/reference or a zero-total request. Unexpected storage
failures use generic `500 INTERNAL_ERROR` without SQL/Prisma details.

P5-M4-T02 history projection adds derived refund state (`NONE`,
`PARTIALLY_REFUNDED`, `FULLY_REFUNDED`), cumulative refunded amount, and remaining
amount while retaining the original Sale total. Detail adds linked refunds and
per-line remaining quantities. Linked refunds order by `(completedAt ASC, id ASC)`;
their items follow original SaleItem `(createdAt ASC, id ASC)` order. The browser
receipt remains the original immutable Sale projection; refund activity is displayed
separately outside its print region. V1 adds no refund-status list filter and no
printable refund document.

## 12. Analytics endpoints

All analytics endpoints return metadata required by `docs/ANALYTICS.md` and only Accepted metrics. Until `OQ-011`/`OQ-016` close, they are blocked as production contracts.

Common query concepts:

```text
scope=branch|organization
branchId=<allowed branch when branch scope>
periodType=daily|weekly|monthly|yearly
period=<canonical selector derived from OQ-011 and OQ-016>
```

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/analytics/sales` | Analytics read | Scope + canonical period + optional dimensions | Accepted sales metrics/trends | Non-comparable/insufficient/stale/inaccessible | Blocked `OQ-011`, `OQ-016` |
| `GET /organizations/{organizationId}/analytics/inventory` | Analytics read | Scope + period/cutoff + optional dimensions | Coverage/movement/risk metrics | Insufficient/zero/reconciliation anomaly/unknown thresholds | Blocked `OQ-011`, `OQ-012`; stock policy `ADR-024` |
| `GET /organizations/{organizationId}/analytics/branches` | Organization analytics read | Period + authorized branch set/filter | Comparable branch metrics | Unauthorized branch/non-comparable period | Blocked `OQ-011`, `OQ-016`; authorization follows `ADR-016` |
| `GET /organizations/{organizationId}/analytics/forecast` | Forecast read | Scope + product/category + horizon | Versioned forecast + data status | Unsupported horizon/insufficient data | Blocked `OQ-012` |
| `GET /organizations/{organizationId}/analytics/reorder-recommendations` | Reorder read | Scope + horizon/filter | Inputs + deterministic recommendations | Missing lead time/forecast/cost/unit | Blocked `OQ-011`, `OQ-012`; future cost/incoming-order semantics follow `ADR-026`; quantity representation follows `ADR-022` |

Analytics error/null semantics:

- No eligible facts may be a successful response with zero counts and explicit null reasons, not necessarily `404`.
- Insufficient history is not a server error.
- A computation failure is not converted to a numeric zero.
- Organization response identifies included authorized branch scope.

## 13. Persisted AI insight endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/ai-insights` | Analytics/insight read | Cadence, scope, cursor | Persisted report summaries/status | Invalid cadence, forbidden scope | Planned after AI decisions |
| `GET /organizations/{organizationId}/ai-insights/latest` | Analytics/insight read | Cadence + scope | Latest successful/stale/failed/insufficient state | No report is an explicit empty state | Planned after AI decisions |
| `GET /organizations/{organizationId}/ai-insights/{insightId}` | Analytics/insight read | None | Content + period/freshness/provenance-safe metadata | Safe not-found/forbidden/version mismatch | Planned after AI decisions |

There is deliberately **no end-user `POST .../generate` endpoint**. Reports are daily/weekly/monthly/yearly scheduled work. Any operational replay mechanism is internal/admin-only, auditable, rate/budget controlled, and designed after `OQ-017`/`OQ-018`.

AI read responses:

- Never call OpenRouter.
- Link to the authoritative analytics snapshot/period.
- Indicate `success`, `stale`, `failed`, `insufficient`, or equivalent accepted status.
- Treat content as untrusted display text: escape it and never render provider-supplied active HTML.
- Do not expose raw prompts, secrets, provider errors, or prohibited data.

## 14. S3/object endpoints

S3 is an accepted cloud service, but no asset upload product requirement is sufficiently defined. Do not add generic upload or presigned-URL endpoints until asset type, authorization, MIME/size limits, malware/content handling, naming, ownership, lifecycle, and retention are accepted under `OQ-015`/`OQ-020` or a new product decision.

## 15. Rate limiting and abuse controls

At minimum, define/test rate limits for:

- Registration/login/password flows
- Search endpoints vulnerable to expensive queries
- Write/idempotency endpoints
- Internal AI replays and provider-budget paths

Except for the four narrow accepted MVP application limiters below, exact thresholds are configuration/production decisions under `OQ-020`. Rate-limit keys must not permit easy cross-tenant denial of service and must respect proxy/ingress trust configuration.

P2-M2-T01 and P2-M2-T02 have accepted MVP exceptions to that deferral. Registration permits
five attempts per 15 minutes per canonical email through a deterministic
process-local in-memory limiter. It stores no database limiter state and logs
neither email nor password. An exhausted limit returns `429 RATE_LIMITED` with
`Retry-After`. Distributed/IP-aware limiting, cross-process coordination, and
proxy/deployment trust remain open under `OQ-020`; this baseline does not close
those questions.

Login separately permits five failed credential attempts per fixed 15-minute
window per canonical email through a SHA-256-derived process-local key. Only
credential failures count and success does not reset the active window.
Exhaustion returns `429 RATE_LIMITED` with `Retry-After`. This does not close the
remaining distributed/IP-aware/global or proxy-trust decisions in `OQ-020`.

Verification resend and password-reset request each use an independent
three-request fixed 15-minute process-local window per canonical email. Every
syntactically valid request consumes before lookup; attempt four returns
`429 RATE_LIMITED` plus deterministic `Retry-After`. Reset completion has no
MVP limiter and rejects invalid token state before Argon2. These exceptions do
not resolve `OQ-020`.

## 16. API test contract

Every endpoint implemented must cover:

- Valid request/response
- Missing, malformed, unknown, oversized, and semantically invalid input
- Unauthenticated request
- Authenticated but wrong role
- Wrong organization and unauthorized branch
- Missing/inactive/deleted dependency
- Duplicate and concurrent request where applicable
- Stable status/error code and safe response body
- Database/provider timeout or failure where applicable
- Decimal/date/cursor serialization boundaries
- No secret/stack/SQL/other-tenant leakage

High-risk commands additionally require database-backed atomicity and idempotency tests.

## 17. Decision references by API area

Canonical definitions live in `BUILD_SPEC.md`:

- Auth/session: `ADR-013`; verification/reset token/provider behavior: `ADR-014`; onboarding: `ADR-015`; invitation/member access lifecycle: `ADR-021`
- Role/permission exposure: `ADR-016`
- Product payload: `ADR-022`; Product has no organization-wide cost/valuation field, Branch/Product cost state follows `ADR-026`, and Sales price/VAT/discount behavior follows `ADR-027`
- Inventory adjustment: `ADR-024`; quantity representation is `ADR-022`; generic
  audit logging remains `OQ-019`
- Purchasing/receiving: `ADR-026`; quantity representation is `ADR-022`, stock policy is `ADR-024`
- Checkout/receipt/payment: `ADR-027` plus `ADR-016`, `ADR-022`, `ADR-024`, and `ADR-026`; `OQ-008` is resolved
- Refund: `ADR-028` plus the applicable Sales/inventory/cost decisions; `OQ-009` is
  resolved and VOID is excluded from V1
- Analytics/forecast: `OQ-011`, `OQ-012`, `OQ-016`
- AI scheduling/provider: `OQ-017`, `OQ-018`
- Hosting, S3, operational exposure: `OQ-015`, `OQ-020`
- Catalog normalization and lifecycle: `ADR-022`; supplier implementation remains sequenced for P4
