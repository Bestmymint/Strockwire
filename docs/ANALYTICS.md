# StockWise Analytics and Forecasting Contract

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1 Source of Truth; `OQ-011` and `OQ-016` resolved by `ADR-029` |
| Compute stack | PostgreSQL SQL + TypeScript |
| AI boundary | OpenRouter summarizes supplied aggregates only |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-09-20 |

## 1. Scope and authority

This is the only authoritative document for analytics terminology, formulas, periods, dimensions, forecast evaluation, replenishment logic, snapshot schema, and scheduled AI report inputs.

`ADR-029` resolves the Analytics V1 metric and reporting-time contract in `OQ-011`
and `OQ-016`. Forecasting, risk/reorder thresholds, job timing, and provider behavior
remain separately governed by `OQ-012`, `OQ-017`, and `OQ-018`.

## 2. Definition status

Every metric or calculation has one status:

- **Accepted:** safe to implement and test as specified.
- **Blocked:** formula shape may be documented, but one or more product decisions are unresolved. Do not implement it as production truth.
- **Deferred:** deliberately excluded from the current Analytics V1 implementation;
  implementation requires a later accepted decision even if its input facts exist.
- **Future:** out of the current MVP unless explicitly promoted.

When an Open Question is answered, update the definition, status, examples, API contract, use cases, tests, and decision log in the same change.

## 3. Non-negotiable analytics rules

1. PostgreSQL/TypeScript calculates every numerical fact, classification, forecast, comparison, and reorder quantity.
2. OpenRouter never calculates metrics, queries the database, forecasts demand, decides stock, or changes operational records.
3. Aggregate only data belonging to the requested organization and authorized branches.
4. Every response/snapshot identifies its scope, canonical period, reporting timezone, metric-definition version, and data completeness.
5. Recognize each immutable fact in its own event period: Sale at `Sale.completedAt`,
   refund at `SaleRefund.completedAt`, receipt at `PurchaseReceipt.receivedAt`, and
   inventory movement at `InventoryTransaction.occurredAt`. Never move a later refund
   back into the original Sale period.
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
| Sale | One immutable completed-by-existence Sale at one Branch, recognized at `completedAt` | Accepted |
| Sale item | Historical product/price/cost/quantity snapshot within a Sale | Accepted |
| Sale refund | One immutable linked REFUND at the original Sale Branch, recognized at its own `completedAt` | Accepted |
| Sale refund item | Historical financial refund quantity plus independent optional restock/cost compensation | Accepted |
| Calendar period | Daily, Monday-based weekly, monthly, or yearly Organization-reporting-time interval | Accepted |

`OWNER` and `ADMIN` Organization analytics include all of that Organization's Branches,
including inactive Branch history. `BRANCH_MANAGER` and `INVENTORY_STAFF` aggregates
include only their currently assigned active Branches; inactive-Branch assignments are
ineffective. The response discloses only the included Branch identifiers/count.
`CASHIER` has no analytics permission.

## 5. Reporting timezone and canonical period model

Each Organization owns one required canonical IANA timezone identifier. V1 has no
Branch timezone. New and existing Organizations use the explicit product default
`Asia/Bangkok` until an `OWNER` or `ADMIN` changes it through a future Organization
settings implementation. The identifier, never a fixed numeric offset, is stored with
the Organization, validated against the runtime's supported IANA identifiers, and
returned by analytics APIs. A missing/invalid persisted value is a configuration/data
error; analytics must not silently fall back to server time or the default at query
time. Transaction/event timestamps remain UTC `timestamptz` values.

Analytics converts local calendar boundaries to UTC with IANA timezone rules. DST days
may therefore contain 23 or 25 hours. Ambiguous/nonexistent local wall times are not API
inputs because clients submit date-only boundaries. Server, database-session, browser,
and device local timezones are never reporting authority.

Changing the Organization timezone re-buckets every on-demand historical query using
the newly current timezone; operational records are not rewritten and no event-time
timezone snapshot is added. A persisted analytics/AI snapshot retains its original
timezone and UTC boundaries and is never silently reinterpreted. A timezone change
invalidates reusable current-definition snapshots for recomputation.

Current operational APIs assign authoritative event timestamps at transaction commit
and do not accept backdated client timestamps. If a future import/repair makes a late
fact visible, the fact belongs to the bucket containing its authoritative event time;
a later on-demand query may therefore change that historical bucket. `sourceCutoff`
distinguishes those query runs, while an already persisted snapshot remains immutable.

All periods use half-open intervals:

```text
[periodStartInclusive, periodEndExclusive)
```

This prevents double counting at adjacent boundaries.

| Period | Intended meaning | Comparison window | Status/blocker |
| --- | --- | --- | --- |
| Daily | Local `00:00` through next local `00:00` | Immediately preceding complete local day | Accepted |
| Weekly | Monday local `00:00` through next Monday local `00:00` | Immediately preceding complete Monday-based week | Accepted |
| Monthly | First local calendar day `00:00` through first day of next month | Immediately preceding complete calendar month | Accepted |
| Yearly | January 1 local `00:00` through January 1 of next year | Immediately preceding complete calendar year | Accepted |

The API accepts canonical period selectors, not arbitrary client-computed timestamps as the source of truth. Exact local job times/catch-up are `OQ-017`.

### API range, bucket, and partial-period rules

- Analytics queries require `from`, `to`, and `granularity`; there is no hidden API
  default. `from` and `to` are strict `YYYY-MM-DD` dates in the Organization reporting
  timezone, with `from` inclusive and `to` exclusive. Date-times and offsets are
  rejected for these fields.
- `granularity` is `day`, `week`, `month`, or `year`. Week ranges align to Monday;
  month ranges to the first day; and year ranges to January 1. Unaligned boundaries,
  `from >= to`, and spans greater than 366 local calendar days are rejected.
- Preset `today` means the current local reporting date at the captured `sourceCutoff`;
  it is normally `partial`. No browser/server timezone participates.
- Each bucket returns its local label plus exact UTC `bucketStartInclusive` and
  `bucketEndExclusive`. Day and week labels use their local start `YYYY-MM-DD`, month
  uses `YYYY-MM`, and year uses `YYYY`.
- Buckets are ascending and gap-filled. Additive money, quantity, and count facts use
  exact zero when no eligible event exists; ratios/coverage/profit with unmet
  prerequisites remain `null` with a reason.

Responses contain `complete`, `partial`, or `insufficient`. V1 never calculates growth
or a period comparison from a partial current bucket; it returns
`NON_COMPARABLE_PERIOD` instead of silently aligning unlike windows.

- `complete`: the requested bucket ended at or before `sourceCutoff` and the metric's
  required authoritative facts are available.
- `partial`: `sourceCutoff` falls inside the requested bucket; additive values are
  valid only through that cutoff and comparisons are null.
- `insufficient`: the period may be complete, but a metric prerequisite such as the
  28-day velocity history or required cost fact is absent. Per-metric null reason and
  cost coverage take precedence over inventing a number.
- `stale` applies only to a persisted snapshot whose age/definition/configuration no
  longer qualifies as current; direct on-demand results are not labeled stale.

## 6. Notation

For a requested scope `S` and period `P`:

- `EligibleSales(S,P)`: every persisted Sale in scope whose `completedAt` is in `P`.
  Existence means completion; there is no Sale status and later refunds do not remove it.
- `EligibleSaleItems(S,P)`: immutable items belonging to `EligibleSales(S,P)`.
- `EligibleRefunds(S,P)`: persisted SaleRefunds in scope whose own `completedAt` is in `P`.
- `EligibleRefundItems(S,P)`: immutable items belonging to `EligibleRefunds(S,P)`.
- `Q_i`: original sold quantity of SaleItem `i`; never reduced by a refund.
- `UnitPrice_i`: historical unit-price snapshot.
- `LineGross_i`: non-negative persisted line-gross allocation before the whole-Sale discount; line sums equal Sale subtotal under `ADR-027`.
- `LineDiscount_i`: non-negative persisted whole-Sale discount allocation, no greater than line gross; line sums equal Sale discount.
- `LineNet_i`: persisted `LineGross_i - LineDiscount_i`; non-negative line sums equal Sale total.
- `LineOutputVat_i`: registered-Sale Output VAT allocated from the discounted VAT-inclusive document total; line sums equal Sale Output VAT. It is `0.00` for NOT_REGISTERED Sales.
- `LineTaxable_i`: registered-Sale `LineNet_i - LineOutputVat_i`; line sums equal Sale taxable amount. It is null, not Sale net, for NOT_REGISTERED Sales.
- `CostBasisState_i`: immutable `KNOWN` or `UNKNOWN` checkout snapshot.
- `UnitCost_i`: nullable historical Branch/Product moving-weighted-average unit-cost snapshot under `ADR-026`/`ADR-027`; null for UNKNOWN basis.
- `LineCogs_i`: nullable persisted `ROUND_HALF_UP(quantity * UnitCost_i, 10)` snapshot; null for UNKNOWN basis and never coerced to zero or backfilled.
- `RefundQuantity_j`, `RefundLineGross_j`, `RefundLineDiscount_j`,
  `RefundLineNet_j`, nullable `RefundLineTaxable_j`, and `RefundLineOutputVat_j`:
  immutable cumulative-target compensation derived from original SaleItem snapshots.
- `RestockQuantity_j` and `RefundCogs_j`: physical return quantity and nullable
  historical COGS reversal. `RefundCogs_j` follows restock quantity, not financial
  refund quantity; a known-cost non-restocked refund has exact zero COGS reversal,
  while a positive UNKNOWN-cost restock has unknown reversal.
- `OnHand(b,p,t)`: branch `b` balance of product `p` at cutoff `t`.
- `Incoming(b,p,H)`: confirmed inbound quantity expected in horizon `H`, once purchase lifecycle is accepted.

`ADR-027` fixes original Sale gross, discount, net, Output VAT, taxable, and cost
snapshots. `ADR-028` fixes immutable refund and optional-restock compensation facts.
`ADR-029` fixes eligibility, recognition period, netting, rounding, and metric meaning.
Current Product category is the V1 category dimension because SaleItem has no category
snapshot; historical category results reclassify when a Product's current category
changes, and uncategorized Products use an explicit `UNCATEGORIZED` bucket.

## 7. Sales metrics catalog

### M-001 Gross sales

**Purpose:** immutable Sale value before whole-Sale discount.

```text
GrossSales(S,P) = sum(LineGross_i for i in EligibleSaleItems(S,P))
```

- Unit: currency decimal
- Grain: branch/organization, optionally category/product
- Status: **Accepted**
- This is VAT-inclusive for REGISTERED Sales because StockWise prices are
  VAT-inclusive. It is also the full price for NOT_REGISTERED Sales. Refunds never
  reduce Gross Sales; they are separate events.

### M-002 Net sales

**Purpose:** primary operational sales amount after discounts and refund compensation.

```text
SalesAfterDiscount(S,P) = sum(LineNet_i for i in EligibleSaleItems(S,P))
RefundAmount(S,P) = sum(RefundLineNet_j for j in EligibleRefundItems(S,P))
NetSales(S,P) = SalesAfterDiscount(S,P) - RefundAmount(S,P)
```

- Unit: currency decimal
- Status: **Accepted**
- All three values are VAT-inclusive. Sale and refund events are recognized in their
  own periods. A refund never edits or re-buckets the original Sale.
- A period with old-Sale refunds and few/no new Sales may legitimately have negative
  Net Sales. Do not clamp it to zero or move the refund to the Sale period.
- These are operational **Sales** metrics, not formal recognized revenue or accounting
  profit claims.

### M-003 Discount metrics

```text
DiscountAmount(S,P) = sum(LineDiscount_i for i in EligibleSaleItems(S,P))
SalesAfterDiscount(S,P) = GrossSales(S,P) - DiscountAmount(S,P)
RefundedDiscountAmount(S,P) = sum(RefundLineDiscount_j for j in EligibleRefundItems(S,P))
```

- Unit: currency decimal
- Status: **Accepted**
- Dashboards may show Gross Sales, Discounts, and Sales After Discount together.
  Refunded discount is compensation metadata and does not rewrite the original
  discount. StockWise has no coupon/campaign/promotion metric in V1.

### M-004 VAT and taxable sales

```text
OutputVatAmount(S,P) = sum(LineOutputVat_i for i in EligibleSaleItems(S,P))
RefundedOutputVatAmount(S,P) = sum(RefundLineOutputVat_j for j in EligibleRefundItems(S,P))
NetOutputVatAmount(S,P) = OutputVatAmount - RefundedOutputVatAmount
```

- Unit: currency decimal
- Status: **Accepted**
- REGISTERED line taxable amount is `LineNet - LineOutputVat`; NOT_REGISTERED taxable
  remains null and Output VAT is `0.00`. Aggregate `registeredTaxableSalesAmount` and
  `refundedRegisteredTaxableAmount` include REGISTERED facts only and return null with
  `NO_REGISTERED_SALES`/`NO_REGISTERED_REFUNDS` when that population is absent.
- VAT-exclusive values are always named explicitly. Headline Gross Sales,
  Sales After Discount, Refund Amount, and Net Sales remain VAT-inclusive.
- These are historical operational tax breakouts, not legal filing/compliance claims.

### M-005 Sale and refund counts

```text
SaleCount(S,P) = count(EligibleSales(S,P))
RefundCount(S,P) = count(EligibleRefunds(S,P))
RefundedSaleCount(S,P) = count(distinct saleId in EligibleRefunds(S,P))
```

- Unit: events/Sales
- Status: **Accepted**
- Partial and fully refunded Sales remain in Sale Count in their original Sale period.
  A Sale with multiple refund events in the same period contributes one to Refunded
  Sale Count and each event contributes to Refund Count.
- A separate time-series `fullyRefundedSaleCount` is deferred because the derived
  lifecycle state is a source-cutoff state, not an additive event-period fact.

### M-006 Quantity metrics

```text
UnitsSoldByProduct(S,P) = sum(Q_i for one Product in EligibleSaleItems(S,P))
UnitsRefundedByProduct(S,P) = sum(RefundQuantity_j for one Product in EligibleRefundItems(S,P))
UnitsRestockedByProduct(S,P) = sum(RestockQuantity_j for one Product in EligibleRefundItems(S,P))
```

- Unit: the Product's immutable base unit
- Status: **Accepted**
- Financial refunded quantity and physical restocked quantity are never substituted for
  one another. A scalar Organization/Branch/category "total units" is prohibited
  across mixed units. Higher grains return per-Product or per-unit breakdowns without
  unit conversion.

### M-007 Average order value (AOV)

```text
AOV(S,P) = SalesAfterDiscount(S,P) / SaleCount(S,P)
```

- Unit: currency decimal per Sale
- Status: **Accepted**
- Refunds are excluded from both numerator and denominator so later refund events are
  not divided by unrelated current-period Sales. Fully refunded Sales remain Sales.
- Zero denominator returns null with `NO_SALES`, never division by zero.

### M-008 Average daily sale depletion (ADS)

```text
ADS(b,p,P) = absolute quantity of SALE ledger depletion / complete CalendarDays(P)
```

- Unit: Product base unit per local calendar day
- Grain: one Branch/Product only
- Status: **Accepted**
- Include zero-depletion calendar days. Do not use store-open schedules. Partial periods
  return null with `INCOMPLETE_PERIOD`.
- Stock coverage uses the immediately preceding 28 complete reporting days. Refund
  returns are reported separately and do not erase observed sale depletion.

### M-009 Net sales growth

For complete canonical current Net Sales `C` and immediately preceding same-granularity
complete Net Sales `B`:

```text
GrowthPercent = ((C - B) / abs(B)) * 100
```

Cases requiring explicit output status:

- `B > 0`: compute percentage.
- `B = 0` and `C = 0`: `0.00%`.
- `B = 0` and `C != 0`: percentage is undefined; return `null` with `NO_BASELINE`, not infinity.
- Partial/non-comparable periods: return `null` with `NON_COMPARABLE_PERIOD`.
- Negative `B` or `C` is allowed because refund-event attribution can produce negative
  Net Sales; the `abs(B)` denominator and signed result must be disclosed.

- Status: **Accepted**.

### M-010 Category sales share

```text
CategoryShare(c,S,P) = CategorySalesAfterDiscount(c,S,P) / SalesAfterDiscount(S,P) * 100
```

- Zero denominator: null with `NO_SALES`.
- Status: **Accepted**.
- Use the Product's current category at query time, with explicit `UNCATEGORIZED`.
  Refund amounts have a separate category breakdown and do not alter this positive-Sale
  share. Category history may reclassify after catalog category changes.

### M-011 Branch performance

Branch performance is not a score. It is a same-period table of accepted metrics such
as Net Sales, Sale Count, AOV, per-unit quantities, and Growth for authorized Branches.

- Status: **Accepted**.
- All Branches use their Organization timezone. Do not include or rank inaccessible
  Branches. Ranking is allowed only by a named accepted metric with deterministic ID
  tie-break; no composite score exists.

### M-012 COGS, gross profit, and gross margin percentage

```text
SaleCogs(S,P) = sum(LineCogs_i for EligibleSaleItems with required KNOWN cost)
RefundCogsReversal(S,P) = sum(RefundCogs_j for positive restock facts)
NetCogs(S,P) = SaleCogs(S,P) - RefundCogsReversal(S,P)
GrossProfit(S,P) = NetSales(S,P) - NetCogs(S,P)
GrossMarginPercent(S,P) = GrossProfit(S,P) / NetSales(S,P) * 100
```

- Status: **Accepted** when cost coverage is complete.
- Refund COGS reversal follows persisted `cogsReversalAmount`, which is driven by
  `restockQuantity`, never financial `refundQuantity`. A known-cost refund with no
  restock has exact `0.0000000000` COGS reversal. A positive UNKNOWN-cost restock has
  unknown reversal. This preserves `ADR-028` rather than inventing accounting history.
- Required UNKNOWN Sale COGS or positive-restock refund reversal makes `NetCogs`,
  Gross Profit, and Gross Margin null. Return `knownNetCogsAmount`,
  `knownCostLineCount`, `unknownCostLineCount`, and `costCoverage: complete|partial|none`
  as diagnostics; the known subtotal is never labeled total COGS/profit.
- Gross Margin Percent is defined only when coverage is complete and Net Sales is
  greater than zero. Zero/negative Net Sales returns null with
  `NON_POSITIVE_NET_SALES`.
- These are operational Gross Profit/Margin metrics, not certified accounting profit.

### Exact decimal and rounding contract

```text
Money from Sale/refund allocations: fixed 2 decimal places
Quantity: fixed 4 decimal places
COGS, inventory value, and Gross Profit: fixed 10 decimal places
AOV, growth percent, share percent, and margin percent: ROUND_HALF_UP to 2 places
```

- PostgreSQL NUMERIC/Prisma Decimal is authoritative. Sum persisted allocations before
  division; do not round individual aggregate inputs again. JSON uses canonical decimal
  strings and JavaScript `number` is never monetary/quantity/percentage authority.
- UI display may localize formatting but never changes the API value or recomputes a
  metric.

## 8. Product movement and inventory metrics

### M-101 Sales velocity

Sales velocity is M-008 ADS at one Branch/Product grain over the accepted 28 complete
reporting-day lookback.

```text
SalesVelocity(b,p) = SALE ledger depletion in prior 28 complete local days / 28
```

- Status: **Accepted**.
- Return null with `INSUFFICIENT_DATA` when 28 complete days are unavailable. There is
  no minimum transaction count and no store-open-day denominator.

### M-102 Stock coverage days

```text
StockCoverageDays(b,p,t) = OnHand(b,p,t) / SalesVelocity(b,p)
```

Required states:

- Positive ADS: numeric days.
- ADS `0` and on-hand `> 0`: `null` with `NO_RECENT_DEMAND` rather than a fake large number.
- ADS `0` and on-hand `= 0`: `null` with `NO_STOCK_AND_NO_DEMAND`.
- Negative on-hand is not an accepted operational state under `ADR-024`; a negative
  value found during reconciliation is an integrity anomaly, not a normal metric input.
- Insufficient/partial history: `null` with `INSUFFICIENT_DATA`.

- Status: **Accepted**; quantity representation is `ADR-022` and no-negative stock is
  `ADR-024`. Round HALF_UP to two decimal days. Current on-hand uses the captured
  `sourceCutoff`; this is not a forecast or service-level promise.

### M-103 Fast-moving / slow-moving classification

Fast/slow classification is explicitly **Deferred** until a later decision supplies a
business threshold or `OQ-012` forecasting context.

Candidate inputs:

- Units or explicitly named Sales-amount velocity in a fixed lookback
- Percentile within comparable category/branch
- Days since last sale
- Stock coverage
- Minimum transaction/data count

- Status: **Deferred**; `OQ-011` is not a license to choose an arbitrary threshold.
- Prohibited: hard-code arbitrary global thresholds in different features.

### M-104 Low-stock state

Low stock requires a manual reorder point or forecast/lead-time policy that does not
exist in the current Product model.

Proposed factual output before classification:

```text
onHand
configuredReorderPoint (if any)
forecastDuringLeadTime (if available)
incomingConfirmed
dataStatus
```

- Status: **Deferred** to `OQ-012` or a separate accepted reorder-point decision.
- This does not block factual `outOfStockProductCount`, defined as the count of active
  Organization Products with current Branch on-hand exactly `0.0000`; an absent lazy
  balance row is zero. Inactive Products are excluded.

### M-105 Stockout risk

Proposed deterministic shape for horizon `H`:

```text
ProjectedAvailable = OnHand + IncomingConfirmed(H)
ProjectedDemand = ForecastDemand(H)
ProjectedEnding = ProjectedAvailable - ProjectedDemand
StockoutRisk = ProjectedEnding < SafetyStock
```

Optional estimated stockout date comes from cumulative daily forecast crossing available quantity.

- Status: **Blocked** only by `OQ-012`; no-negative stock follows `ADR-024`.
- The LLM must never assign this risk.

### M-106 Overstock risk

Candidate definition compares on-hand/coverage with an accepted horizon/threshold and forecast.

```text
CoverageDays > OverstockThresholdDays
```

or an accepted alternative tied to reorder cycles and shelf life.

- Status: **Blocked** only by `OQ-012`.
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

- Status: **Blocked** only by `OQ-012`; quantity representation is accepted by
  `ADR-022` and future confirmed incoming semantics follow `ADR-026`.
- Must decide lead-time source, safety-stock formula, accepted incoming PO state (`ORDERED`), order multiples, minimum order quantity, and unavailable-data behavior.
- Output is a recommendation, not an automatic purchase order.

### M-108 Current on-hand and movement summary

- Status: **Accepted**.
- Current on-hand is `InventoryBalance.quantity` per Branch/Product at the captured
  source cutoff; an absent lazy balance row is `0.0000`. Organization/category views
  return Product/per-unit breakdowns, never a mixed-unit scalar.
- Period movement facts come from immutable InventoryTransaction rows at `occurredAt`:
  `purchaseReceivedQuantity` from positive `PURCHASE_RECEIVE`,
  `saleDepletionQuantity` from absolute negative `SALE`,
  `refundReturnQuantity` from positive `SALE_REFUND_RETURN`, and separate positive and
  absolute-negative `MANUAL_ADJUSTMENT` quantities. Do not net sources into an opaque
  movement number.
- A receiving summary may also count PurchaseReceipts by `receivedAt`; that document
  count is separate from item/ledger quantities.

### M-109 Current inventory value

- Status: **Accepted** for the current source cutoff only; V1 does not claim historical
  point-in-time valuation from current cost-state rows.
- Per Branch/Product, persisted KNOWN `InventoryCostState.inventoryValue` is authority.
  Do not recompute value as quantity times the six-decimal displayed average because
  `ADR-026` retains ten-decimal exact value separately.
- Positive on-hand with UNKNOWN cost makes total `inventoryValue` null. Return
  `knownInventoryValue`, `knownCostProductCount`, `unknownCostProductCount`, and
  unknown quantity by base unit. Zero on-hand with UNKNOWN cost does not make current
  value incomplete because its contribution is exactly zero.
- Current inventory value and all cost-derived analytics require existing
  `SALES_COST_VIEW` in addition to the relevant analytics permission. V1 reuses this
  centralized cost gate rather than adding a second analytics-cost role matrix.

### M-110 Inventory availability facts

- Status: **Accepted** for `activeProductCount`, `inStockProductCount` (`onHand > 0`),
  and `outOfStockProductCount` (`onHand = 0`) at one Branch/source cutoff.
- "Low stock", "stockout risk", "overstock risk", safety stock, and reorder labels
  remain deferred/blocked as stated above. A factual zero balance must not be relabeled
  as forecast risk.

## 9. Query authority, authorization, and performance

Analytics V1 reads authoritative normalized operational tables directly. It adds no
warehouse, OLAP service, event stream, materialized view, scheduled rollup, or new
summary table. A query captures one UTC `sourceCutoff` and must read a transactionally
consistent snapshot so Sale/refund headers and items cannot straddle different cutoffs.
Reusable persisted snapshots are permitted only in later scheduled-report work or
after measured query evidence; they never replace operational truth.

Authorization is server-derived from the active membership and assignments:

| Output | Required permission/scope |
| --- | --- |
| Sales/discount/VAT/refund/count/AOV/category/branch metrics | `BUSINESS_ANALYTICS_VIEW`; `OWNER`/`ADMIN` Organization-wide, assigned `BRANCH_MANAGER` assigned active Branches |
| Inventory quantity/movement/availability/coverage metrics | `INVENTORY_ANALYTICS_VIEW`; `OWNER`/`ADMIN` Organization-wide, assigned `BRANCH_MANAGER`/`INVENTORY_STAFF` assigned active Branches |
| COGS/Gross Profit/Gross Margin/current inventory value or any cost coverage amount | Relevant analytics permission **and** existing `SALES_COST_VIEW`; `OWNER`/`ADMIN` Organization-wide, assigned `BRANCH_MANAGER` assigned active Branches |
| Any analytics | `CASHIER`: none |

Frontend visibility is UX only; it never substitutes for centralized permission and
scope enforcement. Organization aggregates for branch-only roles contain only their
authorized active Branch set and never disclose excluded Branch identifiers.

Interactive requests are limited to 366 local calendar days. Summary/timeseries
buckets within that range are not paginated. Product/category/Branch detail or ranking
rows use stable cursor pagination and a deterministic ID tie-break. Implementation must
validate existing plans and add only evidence-backed indexes in its own task; likely
access paths are Organization/Branch plus Sale/Refund completion time and inventory
movement occurrence time. This decision task adds no index.

## 10. Trend and seasonal analysis

### Trend

A trend beyond accepted period-over-period Net Sales Growth must name its method,
lookback, grain, and confidence/data status.

- Status: **Deferred** to `OQ-012`; two-point M-009 growth is not labeled a trend.
- Prohibited: label simple two-point growth as a statistically established trend without disclosure.

### Seasonal pattern

Seasonality requires enough comparable cycles and must declare its granularity (day-of-week, week-of-year, month-of-year) and minimum history.

- Status: **Blocked** by `OQ-012`.
- With insufficient history, return `INSUFFICIENT_DATA`; OpenRouter must not infer seasonality from a short snapshot.

## 11. Forecasting V1 contract

Forecasting is part of StockWise's deterministic analytics layer, but its V1 algorithm is unresolved.

### Required decision fields (`OQ-012`)

- Forecast target: units, explicitly named Sales amount, or both
- Grain: product/branch, category/branch, branch total
- Horizon(s): next day/week/month or other
- Training/lookback window
- Baseline algorithm, such as naive last-period or moving average
- Candidate algorithm, if different from baseline
- Seasonality and calendar features
- Treatment of stockouts, refunds, price changes, promotions, missing days, and new products; V1 has no VOID operation
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

## 12. Forecast evaluation metrics

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

## 13. Analytics response metadata

Every analytics result must carry enough context to prevent misinterpretation:

```text
metricDefinitionVersion: analytics-v1
scopeType: branch | organization
organizationId
includedBranchIds or includedBranchCount
granularity: day | week | month | year
localFromInclusive
localToExclusive
periodStartInclusive
periodEndExclusive
reportingTimezone
generatedAt
sourceCutoff
dataStatus: complete | partial | insufficient | stale
metric values with explicit null reason where applicable
```

The exact API serialization belongs to `docs/API.md`; these semantic fields are mandatory.

## 14. Analytics snapshot contract for AI

OpenRouter receives a versioned, minimized aggregate snapshot. The exact schema is finalized with metric definitions, but the allowed shape is:

```json
{
  "schemaVersion": "analytics-snapshot-v1",
  "metricDefinitionVersion": "analytics-v1",
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
    "saleCount": 0,
    "averageOrderValue": "decimal-string-or-null"
  },
  "categories": [],
  "inventory": {
    "outOfStockProductCount": 0,
    "stockCoverageStatus": "available-insufficient-not-enabled"
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

## 15. Scheduled report definitions

| Report | Input period | Intended comparison | Output scope | Status |
| --- | --- | --- | --- | --- |
| Daily | Accepted completed local day | Prior complete local day | Branch and/or organization summary | Period accepted; job time remains `OQ-017` |
| Weekly | Accepted completed Monday-based local week | Prior complete week | Branch and/or organization summary | Period accepted; job time remains `OQ-017` |
| Monthly | Accepted completed local calendar month | Prior complete month | Branch and/or organization summary | Period accepted; job time remains `OQ-017` |
| Yearly | Accepted completed local calendar year | Prior complete year | Branch and/or organization summary | Period accepted; job time remains `OQ-017` |

Reports are generated by schedule, persisted, and read from storage. Page views never trigger OpenRouter. If a provider call fails, deterministic analytics remain available and the last successful insight may be shown with age/failure status.

## 16. Idempotency, versioning, and reproducibility

- Snapshot identity includes Organization, included Branch scope, reporting timezone,
  UTC period start/end, period type, and metric-definition version.
- AI report identity includes snapshot, prompt version, model/provider context, and locale if localization is supported.
- A retry must not create duplicate current reports for the same identity.
- Recomputing after a formula change creates a new definition version; it does not silently reinterpret old output.
- Persist source cutoff/watermark and data status.
- Forecast output records algorithm version and input window.
- AI content links to the exact snapshot it summarized.

## 17. Worked metric and time-boundary examples

All money is THB. Unless stated otherwise, `Asia/Bangkok` is the configured reporting
timezone. Examples use the event's authoritative timestamp and do not move refunds
back to their original Sale date.

| # | Persisted event UTC and reporting bucket | Exact metric effect |
| --- | --- | --- |
| 1 | Sale `2026-09-20T03:00:00.000Z`; local `2026-09-20 10:00`; day `2026-09-20` | NOT_REGISTERED Gross Sales/Sales After Discount/Net Sales `100.00`; VAT `0.00`; taxable null; known Net COGS `60.0000000000`; Gross Profit `40.0000000000`. |
| 2 | Sale `2026-09-19T17:00:00.000Z`; local `2026-09-20 00:00`; day `2026-09-20` | The `50.00` Sale belongs to September 20, not the UTC date September 19. One millisecond earlier belongs to September 19. |
| 3 | REGISTERED Sale `2026-09-20T04:00:00.000Z`; day `2026-09-20` | Gross Sales `1070.00`; Discount `107.00`; Sales After Discount/Net Sales `963.00`; taxable `900.00`; Output VAT `63.00`; known COGS `500.0000000000`; Gross Profit `463.0000000000`. |
| 4 | Sale day 1 at `2026-09-20T03:00:00.000Z`, later refund day 5 | Day 1 records Sales After Discount/Net Sales `214.00`, known COGS `120.0000000000`, Gross Profit `94.0000000000`; day 5 alone receives refund effects. |
| 5 | Day-5 partial refund `2026-09-24T03:00:00.000Z` for `0.5000` of an original `2.0000`, fully restocked | Refund Amount `53.50`; Units Refunded/Restocked `0.5000`; Net Sales `-53.50`; COGS reversal `30.0000000000`; Net COGS `-30.0000000000`; Gross Profit `-23.5000000000`. |
| 6 | Day-5 final refund of remaining `1.5000`, fully restocked | Refund Amount `160.50`; COGS reversal `90.0000000000`; cumulative refund `214.00` and reversal `120.0000000000` exactly equal original snapshots; original Sale Count remains `1` on day 1. |
| 7 | Known-cost refund `50.00`, refund quantity `1.0000`, restock `0.0000` | Refund Amount `50.00`; Units Refunded `1.0000`; Units Restocked `0.0000`; COGS reversal `0.0000000000`; Net Sales/Gross Profit effect `-50.00`/`-50.0000000000`. |
| 8 | Known unit cost `40.000000`, refund `50.00` for `1.0000`, restock `0.2500` | COGS reversal `10.0000000000`; Net Sales `-50.00`; Net COGS `-10.0000000000`; Gross Profit `-40.0000000000`. Financial quantity is not replaced by restock quantity. |
| 9 | Known-cost Sale `2026-09-21T03:00:00.000Z` | Sales After Discount/Net Sales `120.00`; Net COGS `70.0000000000`; Gross Profit `50.0000000000`; cost coverage `complete`. |
| 10 | UNKNOWN-cost Sale at the same time/amount | Net Sales `120.00`; `knownNetCogsAmount` `0.0000000000`; Net COGS, Gross Profit, and Margin null; cost coverage `none`; cost is never fabricated as zero. |
| 11 | Period has no Sales and one old-Sale refund `80.00`, no restock | Gross Sales/Sales After Discount `0.00`; Refund Amount `80.00`; Net Sales `-80.00`; Net COGS `0.0000000000`; Gross Profit `-80.0000000000`; Margin null with `NON_POSITIVE_NET_SALES`. |
| 12 | `America/New_York` day `2026-03-08` | Boundaries are `2026-03-08T05:00:00.000Z` to `2026-03-09T04:00:00.000Z`: a valid 23-hour DST day. No fixed-offset or 24-hour addition is allowed. |
| 13 | Bangkok week boundary: `2026-09-20T16:59:59.999Z` then `2026-09-20T17:00:00.000Z` | The first event belongs to week label `2026-09-14`; the second to Monday-based week label `2026-09-21`. Adjacent half-open buckets do not double count. |
| 14 | Bangkok month boundary: `2026-09-30T16:59:59.999Z` then `2026-09-30T17:00:00.000Z` | The first event belongs to `2026-09`; the second to `2026-10`. Year boundaries use the same local-midnight rule. |

## 18. Test fixtures and acceptance

Before a metric becomes Accepted, add fixed fixtures covering:

- Empty period
- One sale and multiple line items
- Multiple branches and organization aggregation
- Unauthorized branch exclusion
- Boundary timestamps at start/end
- DST 23/25-hour boundaries, Monday/week/month/year starts, timezone-change rebucketing,
  and invalid/missing IANA configuration
- Late fact at an earlier authoritative event time with distinct source cutoffs
- Zero baseline and zero denominators
- Partial period
- Product/category changes after historical sale
- Discounts/tax/refunds after their rules are accepted
- Decimal rounding
- Zero stock and negative-stock reconciliation anomaly
- Insufficient history and new product
- Provider failure independent of deterministic analytics

Expected results must be hand-verifiable and stored with the test. SQL and TypeScript implementations of the same definition must agree.

## 19. Decisions still required

Canonical Open Questions are in `BUILD_SPEC.md`:

- `OQ-012` Forecasting V1
- `OQ-017` generation schedule and retries
- `OQ-018` OpenRouter model/fallback/budget/retention
- `OQ-020` performance and retention targets

`OQ-011` and `OQ-016` are resolved by `ADR-029`. Threshold-based movement/risk/reorder
metrics explicitly deferred above remain blocked by `OQ-012` or a future accepted
decision; their deferral does not reopen Analytics V1 metric or timezone semantics.
