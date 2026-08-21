# StockWise Analytics and Forecasting Contract

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1 Source of Truth; metric catalog includes explicit blockers |
| Compute stack | PostgreSQL SQL + TypeScript |
| AI boundary | OpenRouter summarizes supplied aggregates only |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-08-22 |

## 1. Scope and authority

This is the only authoritative document for analytics terminology, formulas, periods, dimensions, forecast evaluation, replenishment logic, snapshot schema, and scheduled AI report inputs.

Some exact definitions are intentionally unresolved by `OQ-011`, `OQ-012`, and `OQ-016`. This file records a single proposed formula shape and its decision status so different implementation tasks cannot silently create competing formulas.

## 2. Definition status

Every metric or calculation has one status:

- **Accepted:** safe to implement and test as specified.
- **Blocked:** formula shape may be documented, but one or more product decisions are unresolved. Do not implement it as production truth.
- **Future:** out of the current MVP unless explicitly promoted.

When an Open Question is answered, update the definition, status, examples, API contract, use cases, tests, and decision log in the same change.

## 3. Non-negotiable analytics rules

1. PostgreSQL/TypeScript calculates every numerical fact, classification, forecast, comparison, and reorder quantity.
2. OpenRouter never calculates metrics, queries the database, forecasts demand, decides stock, or changes operational records.
3. Aggregate only data belonging to the requested organization and authorized branches.
4. Every response/snapshot identifies its scope, canonical period, reporting timezone, metric-definition version, and data completeness.
5. Use accepted completed/recognized sale states only. That set is blocked by `OQ-009` and `OQ-011`.
6. Monetary calculations retain decimal precision; JSON monetary values use canonical decimal strings.
7. Missing, zero, insufficient, stale, and partial data states are explicit. Do not turn them into zero unless zero is the correct semantic value.
8. Historical outputs retain the metric and forecast version used to produce them.
9. Chart labels and AI prose do not redefine metrics.

## 4. Canonical dimensions and grain

| Dimension | Definition | Status |
| --- | --- | --- |
| Organization | One tenant/business | Accepted |
| Branch | One operational branch within the organization | Accepted |
| Product | Organization-level catalog item | Accepted |
| Category | Organization-level product category | Accepted |
| Sale | One accepted sale transaction at one branch | Accepted structurally; included statuses blocked |
| Sale item | Historical product/price/cost/quantity snapshot within a sale | Accepted structurally; included statuses blocked |
| Calendar period | Daily, weekly, monthly, or yearly reporting interval | Accepted set; exact boundaries blocked |

Default organization analytics aggregate the actor's authorized branch set, not automatically every branch in the tenant. The response must disclose the included branch identifiers/count without exposing inaccessible branches.

## 5. Canonical period model

All periods use half-open intervals:

```text
[periodStartInclusive, periodEndExclusive)
```

This prevents double counting at adjacent boundaries.

| Period | Intended meaning | Comparison window | Status/blocker |
| --- | --- | --- | --- |
| Daily | One reporting-calendar day | Immediately preceding comparable day | Boundaries/timezone blocked by `OQ-011`, `OQ-016` |
| Weekly | One reporting-calendar week | Immediately preceding comparable week | Week start/boundaries blocked by `OQ-011`, `OQ-016` |
| Monthly | One reporting-calendar month | Immediately preceding calendar month | Timezone and partial-period behavior blocked |
| Yearly | One reporting-calendar year | Immediately preceding calendar year | Timezone and partial-period behavior blocked |

The API accepts canonical period selectors, not arbitrary client-computed timestamps as the source of truth. Exact local job times/catch-up are `OQ-017`.

### Partial and incomplete periods

Responses must contain a data-completeness indicator such as `complete`, `partial`, or `insufficient`. Comparing a partial current period against a full prior period is prohibited unless `OQ-011` explicitly defines an aligned comparison.

## 6. Notation

For a requested scope `S` and period `P`:

- `EligibleSales(S,P)`: sales in scope and time window whose accepted state is included.
- `EligibleSaleItems(S,P)`: items belonging to `EligibleSales` with accepted reversal treatment.
- `Q_i`: accepted signed or net quantity of sale item `i`.
- `UnitPrice_i`: historical unit-price snapshot.
- `LineGross_i`: price times quantity before line/order discounts according to accepted rounding.
- `LineDiscount_i`: allocated discount for line `i`.
- `LineTax_i`: allocated tax for line `i`.
- `LineNet_i`: recognized sales amount for line `i` according to `OQ-008`/`OQ-011`.
- `UnitCost_i`: historical unit-cost snapshot under the accepted costing model.
- `OnHand(b,p,t)`: branch `b` balance of product `p` at cutoff `t`.
- `Incoming(b,p,H)`: confirmed inbound quantity expected in horizon `H`, once purchase lifecycle is accepted.

The symbols do not answer refund, tax, discount, payment, or completed-state policy. Those remain blockers.

## 7. Sales metrics catalog

### M-001 Gross sales

**Purpose:** value of merchandise before discounts and treatment of taxes/refunds.

```text
GrossSales(S,P) = sum(LineGross_i for i in EligibleSaleItems(S,P))
```

- Unit: currency decimal
- Grain: branch/organization, optionally category/product
- Status: **Blocked** by `OQ-008`, `OQ-009`, `OQ-011`
- Must decide: inclusive/exclusive tax, refund/void sign, order-level discount allocation, rounding.

### M-002 Net sales / recognized sales

**Purpose:** primary sales value shown in management analytics.

Proposed shape:

```text
NetSales(S,P) = sum(LineNet_i for i in EligibleSaleItems(S,P))
```

- Unit: currency decimal
- Status: **Blocked** by `OQ-008`, `OQ-009`, `OQ-011`
- `LineNet` must be defined once; do not subtract tax/refunds differently per dashboard.

### M-003 Units sold

```text
UnitsSold(S,P) = sum(Q_i for i in EligibleSaleItems(S,P))
```

- Unit: product quantity
- Status: **Blocked** by `OQ-009`, `OQ-011`, `OQ-023`
- Aggregating unlike units across all products may be displayed only with a clear label; it is not a physical inventory quantity.

### M-004 Transaction count

```text
TransactionCount(S,P) = count(distinct saleId in EligibleSales(S,P))
```

- Unit: transactions
- Status: **Blocked** by included sale/reversal states in `OQ-009`, `OQ-011`

### M-005 Average order value (AOV)

```text
AOV(S,P) = NetSales(S,P) / TransactionCount(S,P)
```

- Unit: currency decimal per transaction
- Zero-denominator result: `null` with reason `NO_ELIGIBLE_TRANSACTIONS`, never divide by zero
- Status: **Blocked** because M-002 and M-004 are blocked

### M-006 Average daily units sold (ADS)

Proposed calendar-day denominator:

```text
ADS(S,P) = UnitsSold(S,P) / CalendarDays(P)
```

- Include zero-sale calendar days within a complete period.
- A product/branch ADS uses only that product/branch scope.
- Status: **Blocked** by `OQ-011`, `OQ-016`, `OQ-023`
- Must decide: calendar vs open business days, partial periods, minimum data.

### M-007 Sales growth

Proposed shape for comparable current value `C` and previous value `B`:

```text
GrowthPercent = ((C - B) / abs(B)) * 100
```

Cases requiring explicit output status:

- `B > 0`: compute percentage.
- `B = 0` and `C = 0`: proposed `0%` or `NO_CHANGE`; decision unresolved.
- `B = 0` and `C != 0`: percentage is undefined; return `null` with `NO_BASELINE`, not infinity.
- Partial/non-comparable periods: return `null` with `NON_COMPARABLE_PERIOD`.

- Status: **Blocked** by `OQ-011`.

### M-008 Category sales share

```text
CategoryShare(c,S,P) = CategoryNetSales(c,S,P) / NetSales(S,P) * 100
```

- Zero total: `null` with `NO_ELIGIBLE_SALES`.
- Product category treatment uses the accepted historical snapshot/current-category rule from `OQ-011`.
- Status: **Blocked**.

### M-009 Branch performance

Branch performance is not a separate opaque score. It is a dimensioned comparison of accepted metrics such as Net Sales, Transaction Count, AOV, Units Sold, and Growth for authorized branches over the same complete period.

- Status: **Blocked** until underlying metrics and comparison behavior are accepted.
- Do not rank inaccessible branches or mix timezones/periods.

### M-010 Gross margin and gross margin percentage

Proposed shapes:

```text
COGS(S,P) = sum(UnitCost_i * Q_i with accepted reversal treatment)
GrossMargin = NetSales - COGS
GrossMarginPercent = GrossMargin / NetSales * 100
```

- Zero net sales: percentage `null`.
- Status: **Blocked** by `OQ-009`, `OQ-010`, `OQ-011`.
- Not displayable until the costing model and historical unit-cost snapshot are validated.

## 8. Product movement and inventory metrics

### M-101 Sales velocity

Product/branch quantity per accepted time unit:

```text
SalesVelocity(b,p,P) = NetUnitsSold(b,p,P) / ComparableDays(P)
```

- Status: **Blocked** by the same denominator and reversal decisions as ADS.

### M-102 Stock coverage days

Proposed shape:

```text
StockCoverageDays(b,p,t,P) = max(OnHand(b,p,t), 0) / ADS(b,p,P)
```

Required states:

- Positive ADS: numeric days.
- ADS `0` and on-hand `> 0`: `null` with `NO_RECENT_DEMAND` rather than a fake large number.
- ADS `0` and on-hand `= 0`: `null` with `NO_STOCK_AND_NO_DEMAND`.
- Negative on-hand behavior depends on `OQ-007`.
- Insufficient/partial history: `null` with `INSUFFICIENT_DATA`.

- Status: **Blocked** by `OQ-007`, `OQ-011`, `OQ-023`.

### M-103 Fast-moving / slow-moving classification

StockWise will support movement classifications, but no universal threshold is accepted.

Candidate inputs:

- Units or revenue velocity in a fixed lookback
- Percentile within comparable category/branch
- Days since last sale
- Stock coverage
- Minimum transaction/data count

- Status: **Blocked** by `OQ-011`.
- Prohibited: hard-code arbitrary global thresholds in different features.

### M-104 Low-stock state

Low stock may be derived from a manual reorder point, forecasted demand during lead time, or both. The precedence is not accepted.

Proposed factual output before classification:

```text
onHand
configuredReorderPoint (if any)
forecastDuringLeadTime (if available)
incomingConfirmed
dataStatus
```

- Status: **Blocked** by `OQ-011`, `OQ-012` and supplier/purchase definitions.

### M-105 Stockout risk

Proposed deterministic shape for horizon `H`:

```text
ProjectedAvailable = OnHand + IncomingConfirmed(H)
ProjectedDemand = ForecastDemand(H)
ProjectedEnding = ProjectedAvailable - ProjectedDemand
StockoutRisk = ProjectedEnding < SafetyStock
```

Optional estimated stockout date comes from cumulative daily forecast crossing available quantity.

- Status: **Blocked** by `OQ-007`, `OQ-011`, `OQ-012`.
- The LLM must never assign this risk.

### M-106 Overstock risk

Candidate definition compares on-hand/coverage with an accepted horizon/threshold and forecast.

```text
CoverageDays > OverstockThresholdDays
```

or an accepted alternative tied to reorder cycles and shelf life.

- Status: **Blocked** by `OQ-011`, `OQ-012`.
- No global threshold is accepted yet.

### M-107 Reorder recommendation

Proposed formula shape:

```text
RecommendedOrderQuantity = max(
  0,
  ForecastDemandDuringLeadTime
  + SafetyStock
  - OnHand
  - ConfirmedIncoming
)
```

Potential rounding:

```text
Round up to purchasing unit/case size after the raw quantity is computed.
```

- Status: **Blocked** by `OQ-010`, `OQ-011`, `OQ-012`, `OQ-021`, `OQ-023`.
- Must decide lead-time source, safety-stock formula, incoming PO states, order multiples, minimum order quantity, and unavailable-data behavior.
- Output is a recommendation, not an automatic purchase order.

## 9. Trend and seasonal analysis

### Trend

A trend must name its method, lookback, grain, and confidence/data status. Candidate V1 methods include moving average or linear slope over accepted daily aggregates.

- Status: **Blocked** by `OQ-011`/`OQ-012`.
- Prohibited: label simple two-point growth as a statistically established trend without disclosure.

### Seasonal pattern

Seasonality requires enough comparable cycles and must declare its granularity (day-of-week, week-of-year, month-of-year) and minimum history.

- Status: **Blocked** by `OQ-012`.
- With insufficient history, return `INSUFFICIENT_DATA`; OpenRouter must not infer seasonality from a short snapshot.

## 10. Forecasting V1 contract

Forecasting is part of StockWise's deterministic analytics layer, but its V1 algorithm is unresolved.

### Required decision fields (`OQ-012`)

- Forecast target: units, revenue, or both
- Grain: product/branch, category/branch, branch total
- Horizon(s): next day/week/month or other
- Training/lookback window
- Baseline algorithm, such as naive last-period or moving average
- Candidate algorithm, if different from baseline
- Seasonality and calendar features
- Treatment of stockouts, refunds/voids, price changes, promotions, missing days, and new products
- Minimum sample/history requirements and cold-start output
- Retraining/recalculation cadence
- Forecast version and reproducibility metadata
- Evaluation metric and acceptance threshold

### Current implementation boundary

- Use TypeScript and SQL only.
- Do not introduce Python, FastAPI, XGBoost, LightGBM, or a separate ML service now.
- A simple, testable statistical baseline is preferred before more complex models.
- Forecast outputs must expose algorithm/version, horizon, generated-at time, input window, and data status.
- A forecast is an estimate and must not be presented as guaranteed demand.

## 11. Forecast evaluation metrics

These formulas are accepted mathematical definitions, but the primary evaluation metric and product threshold remain `OQ-012`.

For actual values `A_t`, forecasts `F_t`, errors `e_t = A_t - F_t`, and `n` evaluated points:

### E-001 Mean Absolute Error (MAE)

```text
MAE = (1 / n) * sum(abs(A_t - F_t))
```

- Same unit as forecast target.
- Valid only when `n > 0`.

### E-002 Root Mean Squared Error (RMSE)

```text
RMSE = sqrt((1 / n) * sum((A_t - F_t)^2))
```

- Penalizes large misses more than MAE.
- Same unit as target.

### E-003 Weighted Absolute Percentage Error (WAPE)

```text
WAPE = sum(abs(A_t - F_t)) / sum(abs(A_t)) * 100
```

- If total actual demand is zero, WAPE is `null` with `ZERO_ACTUAL_DENOMINATOR`.
- Aggregation weighting and evaluation slices must be reported.

MAPE is not a default because zero/near-zero actual demand makes it unstable. It requires explicit acceptance if added.

### Evaluation protocol requirements

- Use time-ordered holdout/backtesting; do not randomly mix future observations into training.
- Compare candidate Forecasting V1 with a named naive baseline.
- Evaluate by product/branch and a weighted aggregate so high-volume items do not hide cold/slow items.
- Report data exclusions and zero-demand handling.
- Use reproducible synthetic or anonymized data; do not expose personal data.

## 12. Analytics response metadata

Every analytics result must carry enough context to prevent misinterpretation:

```text
metricDefinitionVersion
scopeType: branch | organization
organizationId
includedBranchIds or includedBranchCount
periodType
periodStartInclusive
periodEndExclusive
reportingTimezone
generatedAt
sourceCutoff
dataStatus: complete | partial | insufficient | stale
metric values with explicit null reason where applicable
```

The exact API serialization belongs to `docs/API.md`; these semantic fields are mandatory.

## 13. Analytics snapshot contract for AI

OpenRouter receives a versioned, minimized aggregate snapshot. The exact schema is finalized with metric definitions, but the allowed shape is:

```json
{
  "schemaVersion": "analytics-snapshot-v1",
  "metricDefinitionVersion": "<assigned-when-OQ-011-closes>",
  "scope": {
    "type": "organization-or-branch",
    "displayLabel": "non-sensitive label or omitted"
  },
  "period": {
    "type": "daily-weekly-monthly-yearly",
    "start": "ISO-8601 instant",
    "endExclusive": "ISO-8601 instant",
    "timezone": "IANA timezone"
  },
  "dataStatus": "complete-partial-insufficient",
  "sales": {
    "netSales": "decimal-string-or-null",
    "growthPercent": "decimal-string-or-null",
    "transactionCount": 0,
    "averageOrderValue": "decimal-string-or-null"
  },
  "categories": [],
  "inventory": {
    "lowStockCount": 0,
    "stockoutRiskCount": 0,
    "overstockRiskCount": 0
  },
  "forecast": {
    "status": "available-insufficient-not-enabled",
    "aggregateFacts": {}
  }
}
```

This is a semantic envelope, not an implemented JSON contract. Blocked metrics remain null/omitted until accepted.

### Prohibited AI input

- Customer or employee names, emails, phones, addresses, identifiers, or credentials
- Raw sale, sale-item, payment, purchase, or inventory-ledger rows
- Database schema/connection data
- Secrets, tokens, cookies, environment values, logs, or stack traces
- Instructions asking the model to invent missing metrics, forecasts, or actions

### Prompt behavior requirements

The prompt must require the model to:

- Summarize only supplied facts in plain language for an SME owner.
- State when data is insufficient, partial, or stale.
- Avoid asserting causation not present in the input.
- Avoid recomputing or fabricating numbers.
- Avoid naming individual products unless the accepted snapshot intentionally contains a limited aggregate ranking.
- Avoid automatic purchasing or transaction instructions; phrase replenishment as system-calculated recommendations.

## 14. Scheduled report definitions

| Report | Input period | Intended comparison | Output scope | Status |
| --- | --- | --- | --- | --- |
| Daily | Accepted completed daily period | Prior comparable day | Branch and/or organization summary | Cadence accepted; boundaries/time `OQ-016`/`OQ-017` |
| Weekly | Accepted completed weekly period | Prior comparable week | Branch and/or organization summary | Cadence accepted; boundaries/time unresolved |
| Monthly | Accepted completed calendar month | Prior comparable month | Branch and/or organization summary | Cadence accepted; boundaries/time unresolved |
| Yearly | Accepted completed calendar year | Prior comparable year | Branch and/or organization summary | Cadence accepted; boundaries/time unresolved |

Reports are generated by schedule, persisted, and read from storage. Page views never trigger OpenRouter. If a provider call fails, deterministic analytics remain available and the last successful insight may be shown with age/failure status.

## 15. Idempotency, versioning, and reproducibility

- Snapshot identity includes organization, optional branch scope, period type/start, and metric-definition version.
- AI report identity includes snapshot, prompt version, model/provider context, and locale if localization is supported.
- A retry must not create duplicate current reports for the same identity.
- Recomputing after a formula change creates a new definition version; it does not silently reinterpret old output.
- Persist source cutoff/watermark and data status.
- Forecast output records algorithm version and input window.
- AI content links to the exact snapshot it summarized.

## 16. Test fixtures and acceptance

Before a metric becomes Accepted, add fixed fixtures covering:

- Empty period
- One sale and multiple line items
- Multiple branches and organization aggregation
- Unauthorized branch exclusion
- Boundary timestamps at start/end
- Zero baseline and zero denominators
- Partial period
- Product/category changes after historical sale
- Discounts/tax/refunds after their rules are accepted
- Decimal rounding
- Negative/zero stock according to `OQ-007`
- Insufficient history and new product
- Provider failure independent of deterministic analytics

Expected results must be hand-verifiable and stored with the test. SQL and TypeScript implementations of the same definition must agree.

## 17. Decisions still required

Canonical Open Questions are in `BUILD_SPEC.md`:

- `OQ-007` negative stock
- `OQ-008` payment, tax, discount, and sale totals
- `OQ-009` refund/void treatment
- `OQ-010` costing/COGS
- `OQ-011` exact metric definitions, thresholds, comparison windows, and eligible states
- `OQ-012` Forecasting V1
- `OQ-016` reporting timezone and period boundaries
- `OQ-017` generation schedule and retries
- `OQ-018` OpenRouter model/fallback/budget/retention
- `OQ-020` performance and retention targets
- `OQ-021` inbound quantity states
- `OQ-023` quantity units and precision
