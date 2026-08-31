# StockWise REST API Contract

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1 contract; identity/access, branch/member management, and Catalog API implemented |
| Base path | `/api/v1` |
| Style | JSON REST |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-25 |

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

`basePrice` is the required organization-level configured amount shared by every branch. It is a non-negative decimal string with at most four fractional digits; inputs with greater scale are rejected rather than rounded. It does not define sales tax, discounts, receipt totals, payment behavior, or sales monetary rounding, which remain blocked by the remaining sales-side `OQ-008`. Product has no organization-wide cost/valuation field; future Branch/Product cost state follows `ADR-026`. Branch overrides are out of MVP scope by `ADR-022`.

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
`MANUAL_ADJUSTMENT`. History returns its movement ID, canonical decimal-string
delta, source/reason/note, timestamp, and minimal actor ID/display name. It never
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
| `GET /organizations/{organizationId}/branches/{branchId}/purchase-orders` | Branch purchasing read | Cursor/status/date/supplier | Purchase order summaries | Invalid range/cursor | Planned; lifecycle accepted by `ADR-026` |
| `POST /organizations/{organizationId}/branches/{branchId}/purchase-orders` | Branch purchasing write | Supplier, one line per Product, quantities, expected THB costs | Purchase order | Cross-tenant/inactive refs, invalid/duplicate lines/cost | Planned; `DRAFT` lifecycle follows `ADR-026`, quantity follows `ADR-022` |
| `GET /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}` | Branch purchasing read | None | Order, immutable snapshots, receipt summary | Safe not-found | Planned |
| `PATCH /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}` | Branch purchasing write | DRAFT fields or accepted state intent/version | Purchase order | Non-editable/stale/terminal-state conflict | Planned; lifecycle follows `ADR-026` |
| `POST /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}/receipts` | Branch receiving | `Idempotency-Key`; actual THB costs and bounded document-level Input VAT snapshot, no received quantities | Completed receipt + balance/cost effects | ORDERED/exact-quantity/cost/idempotency/concurrency | Planned; `ADR-022`, `ADR-024`, and `ADR-026` |

Receipt creation is a future atomic command. It derives every receipt quantity from the frozen ORDERED PO, creates at most one immutable receipt, and does not expose a sequence of public endpoints for separately creating a receipt and then mutating stock. Partial/over/short/multiple receipt, receiving without a PO, supplier returns, and receipt correction/reversal have no MVP endpoint.

## 11. POS and sales endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/branches/{branchId}/pos/products` | Branch checkout | Query/barcode/cursor | Sellable product summaries with current server price/availability indicator | Invalid query, forbidden branch | Planned; exact availability/price blocked |
| `POST /organizations/{organizationId}/branches/{branchId}/sales` | Branch checkout | `Idempotency-Key`; cart lines and payment intent | Completed sale + receipt representation | Price/state/stock/payment/idempotency/concurrency | Blocked remaining sales-side `OQ-008`; future cost snapshots follow `ADR-026`; quantity validation follows `ADR-022`, stock policy `ADR-024` |
| `GET /organizations/{organizationId}/branches/{branchId}/sales` | Branch sales read | Cursor/date/user/status filters | Sale summaries | Invalid range/cursor | Planned; statuses blocked `OQ-009` |
| `GET /organizations/{organizationId}/branches/{branchId}/sales/{saleId}` | Branch sales read | None | Sale, immutable lines, permitted payment data | Safe not-found | Planned |
| `GET /organizations/{organizationId}/branches/{branchId}/sales/{saleId}/receipt` | Branch receipt read | Format/locale if accepted | Receipt view data; not arbitrary HTML from server | Safe not-found/forbidden | Blocked format/numbering `OQ-008` |

Conceptual checkout request:

```json
{
  "items": [
    {
      "productId": "opaque-id",
      "quantity": "2"
    }
  ],
  "payment": {
    "method": "<accepted-method-from-OQ-008>",
    "amountTendered": "<accepted-decimal-from-OQ-008>"
  }
}
```

Rules:

- Client may show an estimate but server reloads product status/price and computes every authoritative total.
- Quantity representation follows `ADR-022`; payment method, tax, discount, tender/change, split payments, and transaction rounding remain `OQ-008`.
- Response uses immutable sale snapshot values.
- OpenRouter is never called in checkout.

No void/refund endpoints are defined until `OQ-009` closes. Likely action paths must be designed from accepted lifecycle rather than generic `DELETE /sales/{id}`. Deleting a completed sale is prohibited.

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
- Product payload: `ADR-022`; Product has no organization-wide cost/valuation field, future Branch/Product cost state follows `ADR-026`, sales monetary behavior remains in the unresolved portions of `OQ-008`
- Inventory adjustment: `ADR-024`; quantity representation is `ADR-022`; generic
  audit logging remains `OQ-019`
- Purchasing/receiving: `ADR-026`; quantity representation is `ADR-022`, stock policy is `ADR-024`
- Checkout/receipt/payment: `ADR-024`, `ADR-026`, `OQ-008`; quantity representation is `ADR-022`
- Void/refund: `OQ-009`
- Analytics/forecast: `OQ-011`, `OQ-012`, `OQ-016`
- AI scheduling/provider: `OQ-017`, `OQ-018`
- Hosting, S3, operational exposure: `OQ-015`, `OQ-020`
- Catalog normalization and lifecycle: `ADR-022`; supplier implementation remains sequenced for P4
