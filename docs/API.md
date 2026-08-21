# StockWise REST API Contract

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1 planning contract; transport shell and operational probes implemented |
| Base path | `/api/v1` |
| Style | JSON REST |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-22 |

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

The transport and browser storage of authenticated state are **Blocked by `OQ-003`**. Until accepted, this contract uses these semantic labels:

- **Public:** no authenticated state required, but abuse protection may apply.
- **Authenticated:** valid accepted session/token required.
- **Organization-scoped:** authenticated membership plus role permission.
- **Branch-scoped:** authenticated organization membership/relationship, allowed branch, and role permission.
- **System:** least-privilege scheduled job or internal operational identity; not an end-user API.

Do not lock in bearer headers, cookies, refresh endpoints, CSRF behavior, or token response fields before `OQ-003`.

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
- Identity includes trusted tenant/branch and operation type.
- Same key + semantically same payload returns the same logical outcome.
- Same key + different payload returns `409 IDEMPOTENCY_CONFLICT`.
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

The accepted MVP role names are `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `INVENTORY_STAFF`, and `CASHIER`. `OQ-022` does not reopen those names; it blocks the exact organization/branch permission matrix, delegation, membership administration, operational permissions, cost/margin visibility, organization-wide analytics access, and governance rules. Resource status/lifecycle enums remain governed by their relevant open decisions.

### `Product`

```json
{
  "id": "opaque-id",
  "organizationId": "opaque-id",
  "categoryId": "opaque-id-or-null",
  "sku": "COKE-325",
  "barcode": "8850000000000",
  "name": "Coke 325 ml",
  "unit": "piece",
  "sellingPrice": "20.00",
  "status": "active",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Cost and branch override fields remain blocked by `OQ-010`/`OQ-014`.

## 5. Health and service endpoints

| Method/path | Auth | Request | Response | Validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /health` | Public | None | `200 {"status":"ok"}` while the API process handles requests; does not check dependencies | No dependency detail | Implemented in foundation |
| `GET /ready` | Deployment/internal exposure policy | None | `200 {"status":"ready"}` when every configured required dependency is ready; `503 {"status":"not_ready"}` otherwise | `503 SERVICE_UNAVAILABLE`; no connection details | Implemented in foundation; exposure policy still depends on `OQ-015` |

Health endpoints must not return environment values, versions with known exploit value, SQL errors, credentials, or OpenRouter secrets.

At this foundation stage the API has no required external dependency, so the default readiness result is ready. Future resource-owning tasks must register only their required dependency checks and must preserve the same status-only response contract.

### 5.1 Local web development path

For local development only, the Next.js server proxies its same-origin
`GET /api/health` request to the Express `GET /health` operational probe. The
browser never calls the Express loopback listener directly. This is not a
StockWise business REST endpoint and does not change the `/api/v1` API base path.

The root `.env` supplies `STOCKWISE_API_PORT=3001` to the API and
`STOCKWISE_API_ORIGIN=http://127.0.0.1:3001` to the Next.js server; the browser
server runs on fixed port `3000`. Both values are validated by their owning
process and the origin value is server-only.

Express does not enable CORS for this development path. It listens on
`127.0.0.1` and emits no `Access-Control-Allow-Origin` header, including for a
direct request carrying `Origin: http://localhost:3000`. The Next.js proxy is
therefore the sole browser path for the health check.

## 6. Identity and account endpoints

### Endpoint catalog

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/register` | Public | Email, password, accepted registration fields | Next-step/account-safe result governed by `OQ-003`–`OQ-005` | Invalid/duplicate/rate limit/provider failure | Blocked `OQ-004`, `OQ-005` |
| `POST /auth/login` | Public | Email, password | Authenticated state and safe user context governed by `OQ-003` | Generic invalid credentials, disabled/unverified, rate limit | Blocked `OQ-003`, `OQ-004` |
| `POST /auth/logout` | Authenticated/idempotent | Revocation scope governed by `OQ-003` | Revocation result | Invalid/expired state; dependency failure | Blocked `OQ-003` |
| `GET /me` | Authenticated | None | Safe profile and onboarding status | Authentication required | Blocked field details `OQ-005` |
| `PATCH /me/profile` | Authenticated | Accepted editable profile fields | Updated safe profile | Validation, stale/conflict | Blocked `OQ-005` |
| `GET /me/organizations` | Authenticated | Pagination if needed | Accessible organization summaries | Authentication required | Planned |
| `GET /organizations/{organizationId}/branches` | Organization-scoped | Filters/pagination | Accessible branch summaries | Not found/forbidden safely | Planned |

There are no Google OAuth endpoints in the MVP contract.

### Registration/login security requirements

- Do not return password hashes or credential metadata.
- Do not reveal account existence through materially different messages/timing where practical.
- Apply rate limiting and security telemetry without logging submitted passwords.
- Session/cookie/CSRF/refresh contracts are added only after `OQ-003` closes.

## 7. Organization, branch, and membership endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `POST /organizations` | Authenticated incomplete/onboarding account | Accepted organization and first-branch fields | Organization/branch context | Duplicate submission, invalid fields | Blocked `OQ-005` |
| `GET /organizations/{organizationId}` | Organization-scoped | None | Organization detail allowed to role | Safe not-found/forbidden | Planned |
| `PATCH /organizations/{organizationId}` | Organization admin | Editable fields | Updated organization | Validation/state/stale conflict | Blocked field/permission details |
| `POST /organizations/{organizationId}/branches` | Organization admin | Code, name, accepted fields | Created branch | Duplicate code, invalid state | Blocked `OQ-005`, `OQ-022` |
| `GET /organizations/{organizationId}/members` | Organization admin | Cursor/filter | Members and branch scopes | Invalid cursor, forbidden | Blocked `OQ-022` |
| `POST /organizations/{organizationId}/invitations` | Organization admin | Email, role, branch assignments | Invitation state | Duplicate/role escalation/provider failure | Blocked `OQ-006`, `OQ-022` |
| `PATCH /organizations/{organizationId}/members/{userId}` | Organization admin | Role/status/branch assignments | Updated membership | Last-owner/role escalation/stale state | Blocked `OQ-006`, `OQ-022` |

No endpoint may accept an arbitrary `organizationId` in the body as ownership truth.

## 8. Catalog endpoints

All paths are organization-scoped because catalog resources belong to an organization.

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/categories` | Catalog read | Cursor/search/status | Categories | Invalid cursor/filter | Planned |
| `POST /organizations/{organizationId}/categories` | Catalog write | Name, description/status as accepted | Category | Duplicate/normalization behavior governed by `OQ-024` | Blocked `OQ-024` |
| `PATCH /organizations/{organizationId}/categories/{categoryId}` | Catalog write | Editable fields | Category | Cross-tenant ref, stale state | Planned |
| `GET /organizations/{organizationId}/products` | Catalog read | Cursor, query, SKU/barcode/category/status | Products | Invalid filters/cursor | Planned |
| `POST /organizations/{organizationId}/products` | Catalog write | Product fields | Product | Duplicate SKU/barcode, invalid category/decimal | Blocked `OQ-010`, `OQ-014`, `OQ-023`, `OQ-024` |
| `GET /organizations/{organizationId}/products/{productId}` | Catalog read | None | Product | Safe not-found | Planned |
| `PATCH /organizations/{organizationId}/products/{productId}` | Catalog write | Editable fields and concurrency token if selected | Product | Duplicate/stale/history constraints | Blocked `OQ-010`, `OQ-014`, `OQ-023`, `OQ-024` |

Create/update validation:

- SKU required and unique within organization after normalization.
- Barcode optional and unique within organization when present.
- Category must belong to the same organization.
- Selling price is a non-negative canonical decimal according to accepted pricing rules.
- Product status and fractional quantity/unit behavior follow `OQ-023`.
- Client cannot create branch price data until `OQ-014` accepts the feature.

## 9. Inventory endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/branches/{branchId}/inventory` | Branch inventory read | Cursor, product/category/status/stock filters | Product + current balance page | Invalid filter, forbidden branch | Planned; analytic filters blocked `OQ-011` |
| `GET /organizations/{organizationId}/branches/{branchId}/inventory/{productId}` | Branch inventory read | None | Current balance and product summary | Safe not-found/cross-tenant | Planned |
| `GET /organizations/{organizationId}/branches/{branchId}/inventory/{productId}/transactions` | Branch inventory read | Cursor, type/date filters | Stable ledger page | Invalid range/cursor | Planned |
| `POST /organizations/{organizationId}/branches/{branchId}/inventory/adjustments` | Branch stock adjust | `Idempotency-Key`; product, signed quantity, reason | Movement + new balance | Invalid/zero, insufficient stock, duplicate/conflict | Blocked `OQ-007`, `OQ-019`, `OQ-022`, `OQ-023` |

Adjustment request must not contain an authoritative resulting balance. The server applies a delta within one transaction.

No transfer endpoint exists until `OQ-013` is accepted.

## 10. Supplier and purchasing endpoints

### Suppliers

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/suppliers` | Purchasing read | Cursor/search/status | Suppliers | Invalid cursor/filter | Planned |
| `POST /organizations/{organizationId}/suppliers` | Purchasing write | Accepted supplier fields | Supplier | Validation/duplicate/lifecycle policy | Blocked `OQ-024` |
| `GET /organizations/{organizationId}/suppliers/{supplierId}` | Purchasing read | None | Supplier | Safe not-found | Planned |
| `PATCH /organizations/{organizationId}/suppliers/{supplierId}` | Purchasing write | Editable fields | Supplier | Stale/inactive/history rules | Blocked `OQ-024` |

### Purchase orders and receipts

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/branches/{branchId}/purchase-orders` | Branch purchasing read | Cursor/status/date/supplier | Purchase order summaries | Invalid range/cursor | Blocked lifecycle details `OQ-021` |
| `POST /organizations/{organizationId}/branches/{branchId}/purchase-orders` | Branch purchasing write | Supplier, lines, quantities, expected costs | Purchase order | Cross-tenant refs, invalid/duplicate lines/cost | Blocked `OQ-010`, `OQ-021`, `OQ-023` |
| `GET /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}` | Branch purchasing read | None | Order, snapshots, receipt summary | Safe not-found | Blocked lifecycle representation |
| `PATCH /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}` | Branch purchasing write | Editable fields/state version | Purchase order | Non-editable/stale/state conflict | Blocked `OQ-021` |
| `POST /organizations/{organizationId}/branches/{branchId}/purchase-orders/{purchaseOrderId}/receipts` | Branch receiving | `Idempotency-Key`; received lines/actual cost | Completed receipt + balance effects | State/quantity/cost/idempotency/concurrency | Blocked `OQ-007`, `OQ-010`, `OQ-021`, `OQ-023` |

Receipt creation is an atomic command. It does not expose a sequence of public endpoints for separately creating a receipt and then mutating stock.

## 11. POS and sales endpoints

| Method/path | Auth | Request | Response | Key validation/errors | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /organizations/{organizationId}/branches/{branchId}/pos/products` | Branch checkout | Query/barcode/cursor | Sellable product summaries with current server price/availability indicator | Invalid query, forbidden branch | Planned; exact availability/price blocked |
| `POST /organizations/{organizationId}/branches/{branchId}/sales` | Branch checkout | `Idempotency-Key`; cart lines and payment intent | Completed sale + receipt representation | Price/state/stock/payment/idempotency/concurrency | Blocked `OQ-007`, `OQ-008`, `OQ-010`, `OQ-023` |
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
- Quantity, method, tax, discount, tender/change, split payments, and rounding are finalized by `OQ-008`/`OQ-023`.
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
| `GET /organizations/{organizationId}/analytics/inventory` | Analytics read | Scope + period/cutoff + optional dimensions | Coverage/movement/risk metrics | Insufficient/negative/unknown thresholds | Blocked `OQ-007`, `OQ-011`, `OQ-012` |
| `GET /organizations/{organizationId}/analytics/branches` | Organization analytics read | Period + authorized branch set/filter | Comparable branch metrics | Unauthorized branch/non-comparable period | Blocked `OQ-011`, `OQ-016`, `OQ-022` |
| `GET /organizations/{organizationId}/analytics/forecast` | Forecast read | Scope + product/category + horizon | Versioned forecast + data status | Unsupported horizon/insufficient data | Blocked `OQ-012` |
| `GET /organizations/{organizationId}/analytics/reorder-recommendations` | Reorder read | Scope + horizon/filter | Inputs + deterministic recommendations | Missing lead time/forecast/cost/unit | Blocked `OQ-010`, `OQ-011`, `OQ-012`, `OQ-021`, `OQ-023` |

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

Exact thresholds are configuration/production decisions under `OQ-020`. Rate-limit keys must not permit easy cross-tenant denial of service and must respect proxy/ingress trust configuration.

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

## 17. Blocking questions by API area

Canonical definitions live in `BUILD_SPEC.md`:

- Auth endpoints: `OQ-003`, `OQ-004`, `OQ-005`, `OQ-006`
- Role/permission exposure: `OQ-022`
- Product payload: `OQ-010`, `OQ-014`, `OQ-023`
- Inventory adjustment: `OQ-007`, `OQ-019`, `OQ-023`
- Purchasing/receiving: `OQ-010`, `OQ-021`, `OQ-023`
- Checkout/receipt/payment: `OQ-007`, `OQ-008`, `OQ-010`, `OQ-023`
- Void/refund: `OQ-009`
- Analytics/forecast: `OQ-011`, `OQ-012`, `OQ-016`
- AI scheduling/provider: `OQ-017`, `OQ-018`
- Hosting, S3, operational exposure: `OQ-015`, `OQ-020`
- Catalog/supplier normalization and lifecycle: `OQ-024`
