# StockWise Analytics and Forecasting Contract

| Field | Value |
| --- | --- |
| Status | Architecture Freeze v1 Source of Truth; `OQ-011`/`OQ-016` resolved by `ADR-029`, `OQ-012` resolved for Forecasting V1 by `ADR-031` |
| Compute stack | PostgreSQL SQL + TypeScript |
| AI boundary | OpenRouter summarizes supplied aggregates only |
| Baseline | Architecture Freeze v1 |
| Last updated | 2026-09-24 |

## 1. Scope and authority

This is the only authoritative document for analytics terminology, formulas, periods, dimensions, forecast evaluation, replenishment logic, snapshot schema, and scheduled AI report inputs.

`ADR-029` resolves the Analytics V1 metric and reporting-time contract in `OQ-011`
and `OQ-016`. `ADR-030` accepts fixed V1 coverage-based stock classification.
`ADR-031` resolves `OQ-012` for Forecasting V1 only. Stockout risk, safety stock,
lead-time/reorder policy, and other deferred classifications require their own later
accepted decisions; job timing and provider behavior remain `OQ-017` and `OQ-018`.

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

Current operational APIs assign authoritative event timestamps within their write
transactions, before commit, and do not accept backdated client timestamps. A delayed
commit can therefore make a fact whose event time is at or before an earlier
`sourceCutoff` visible to a later read snapshot. The fact belongs to the bucket
containing its authoritative event time. `sourceCutoff` is an event-time bound,
not a commit-visibility or multi-page snapshot boundary. An already persisted
snapshot remains immutable.

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
- `Incoming(b,p,H)`: proposed inbound quantity within horizon `H`; eligibility and
  expected-arrival authority remain undecided for replenishment.

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
- This requested-period ADS uses only complete days in its requested canonical period;
  it is distinct from the fixed 28-day coverage velocity in M-101. Stock coverage uses
  the immediately preceding 28 complete reporting days. Refund returns are reported
  separately and do not erase observed sale depletion.

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

#### P6-M2-T02 Category performance row contract

P6-M2-T02 returns one cursor-paged Category series per current Category with eligible
SaleItem or SaleRefundItem activity in the requested range. Each series contains one
row for every canonical requested bucket, including zero-filled additive facts for a
bucket in which that selected Category has no activity. It has no whole-range row; a
request spanning multiple buckets is represented by those same canonical buckets.

Each row contains only the following accepted Category fields:

- `categoryKind: CATEGORY|UNCATEGORIZED`, `categoryId: UUID|null`, current display
  name, and current `ACTIVE|INACTIVE` status for `CATEGORY` (`null` for
  `UNCATEGORIZED`);
- Gross Sales, Discount Amount, Sales After Discount, Refund Amount, and Net Sales;
  and
- Category Share, calculated from exact amounts before final rounding.

The stable uncategorized identity is the typed pair
`(categoryKind=UNCATEGORIZED, categoryId=null)`, never a synthetic persisted row or a
string that could collide with a Category UUID. Its display label is
`UNCATEGORIZED`. It participates in every Category money reconciliation and in both
the numerator and denominator of Category Share. Real Categories order by Category ID
ascending and `UNCATEGORIZED` sorts after every real Category; this is deterministic
presentation order, not a ranking. No Top-N, configurable Category sort, or Category
ranking is accepted.

For bucket `P` and the same authorized Branch scope `S` as the response:

```text
CategoryShare(c,S,P) = CategorySalesAfterDiscount(c,S,P)
                       / SalesAfterDiscount(S,P) * 100
```

The denominator includes every eligible SaleItem in that bucket/scope, including
`UNCATEGORIZED`, and excludes refunds. It is `null` with `NO_SALES` only when the
denominator is exactly zero. A negative denominator cannot occur because persisted
SaleItem `lineNet` is non-negative; refund-event net sales do not participate. Shares
are informational and individual values round `ROUND_HALF_UP` to two decimal places,
so displayed values need not sum to exactly `100.00`.

Category Sale Count, Refund Count, Refunded Sale Count, AOV, VAT/taxable breakouts,
COGS/cost coverage/profit/margin, growth, and quantity outputs are **Deferred** from
P6-M2-T02. In particular, a distinct-Sale Category count would be non-additive when a
Sale contains lines from multiple Categories, and a scalar Category quantity would be
invalid across mixed Product units. These facts must not be inferred from the Category
row contract merely because P6-M2-T01 can calculate related base metrics.

Category attribution is intentionally current-state V1 behavior: at query time,
`SaleItem.productId` and `SaleRefundItem.productId` resolve to the current
`Product.categoryId`. A Product reassignment reclassifies historical Sale and Refund
facts; `categoryId=null` reclassifies them to `UNCATEGORIZED`; a Category rename
changes the current display name; and an inactive, still-referenced Category remains
eligible. SaleItem and SaleRefundItem have no Category-at-event snapshot, and no
schema change is required for this accepted V1 behavior. Refund facts are recognized
at `SaleRefund.completedAt`; their financial Category Refund Amount is the immutable
`reversedLineNet`, irrespective of `restockQuantity`.

Category additive reconciliation includes `UNCATEGORIZED`: sums per bucket/scope of
Gross Sales, Discount Amount, Sales After Discount, Refund Amount, and Net Sales must
equal the corresponding P6-M2-T01 base values. No eligible line fact may disappear.

### M-011 Branch performance

Branch performance is not a score. It is a same-period table of accepted metrics such
as Net Sales, Sale Count, AOV, per-unit quantities, and Growth for authorized Branches.

- Status: **Accepted**.
- All Branches use their Organization timezone. Do not include or rank inaccessible
  Branches. Ranking is allowed only by a named accepted metric with deterministic ID
  tie-break; no composite score exists.

#### P6-M2-T02 Branch comparison row contract

P6-M2-T02 returns one cursor-paged Branch series for every Branch in the already
authorized scope, including zero-filled additive facts for every canonical requested
bucket. It has no whole-range row. Stable identity is `Branch.id`; the label is the
current Branch name and each row exposes current `ACTIVE|INACTIVE` state. This does
not imply a historical Branch-name snapshot. `OWNER`/`ADMIN` may receive inactive
Branch rows; `BRANCH_MANAGER` cannot receive inactive or unassigned Branch rows.

Each Branch bucket row contains the complete P6-M2-T01 Sales metric set: Gross Sales,
Discount Amount, Sales After Discount, Output VAT, registered Taxable Sales, Refund
Amount, Refunded Discount, Refunded Output VAT, refunded registered Taxable amount,
Net Output VAT, Net Sales, Sale Count, Refund Count, Refunded Sale Count, AOV, and
Net Sales Growth. It contains the P6-M2-T01 COGS/profit fields and their coverage
diagnostics only when the authorized scope has `SALES_COST_VIEW`; otherwise those
fields are omitted, exactly as in P6-M2-T01. Quantity outputs are Deferred: no scalar
Branch quantity is valid across mixed Product units, and product/unit breakdowns are
outside this task.

P6-M2-T02 does not implement ranking. Branch rows are deterministic comparison rows
ordered by `Branch.id` ascending, not a score or performance ranking. Configurable
ranking, a ranking metric/direction, Top-N, null ordering, and ranking-specific cursors
are Deferred until a later accepted contract names them. Branch additive metrics must
reconcile per bucket/scope to P6-M2-T01; AOV, Growth, margins, and percentages are
derived metrics and do not sum.

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
- At `sourceCutoff`, find the start of its current Organization-local day. The window
  is the 28 complete local calendar days ending at that boundary, `[D - 28 days, D)`;
  map both local midnights through the Organization IANA timezone. The current local
  day never contributes, including across 23-hour and 25-hour DST days.
- The Branch/Product history eligibility marker is its earliest visible
  `InventoryTransaction.occurredAt`, for that exact pair, at or before the event
  `sourceCutoff`. History is sufficient only when that marker is on or before the
  window start. No movement, or a first movement after the window start, returns null
  with `INSUFFICIENT_DATA`. Product or Branch creation and first SALE do not establish
  Branch/Product eligibility.
- Once eligible, sum absolute negative `SALE` deltas in the window and divide by 28
  complete local days. Days without SALE depletion count as zero; no minimum SALE count
  or store-open-day denominator applies. An eligible zero numerator yields exact zero,
  not insufficient history. Receipts, refund returns, and adjustments do not change
  observed SALE depletion. The unit is the Product base unit per local day.

### M-102 Stock coverage days

```text
StockCoverageDays(b,p,t) = OnHand(b,p,t) / SalesVelocity(b,p)
```

Required states:

- Positive M-101 coverage velocity: numeric days.
- M-101 velocity `0` and on-hand `> 0`: `null` with `NO_RECENT_DEMAND` rather than a fake large number.
- M-101 velocity `0` and on-hand `= 0`: `null` with `NO_STOCK_AND_NO_DEMAND`.
- Negative on-hand is not an accepted operational state under `ADR-024`; a negative
  value found during reconciliation is an integrity anomaly, not a normal metric input.
- Insufficient 28-day history: `null` with `INSUFFICIENT_DATA`.

- Status: **Accepted**; quantity representation is `ADR-022` and no-negative stock is
  `ADR-024`. Round HALF_UP to two decimal days. The numerator is current on-hand from
  the page's consistent projection read at `currentSnapshotCapturedAt`; the denominator
  is M-101 at the cursor-bound event `sourceCutoff`. A later page can therefore have
  a newer numerator. Negative or ledger-divergent on-hand returns null with
  `INVENTORY_INTEGRITY_ERROR`, never a coverage number. This is not a forecast or
  service-level promise.

### M-103 Fast-moving / slow-moving classification

Fast/slow classification is explicitly **Deferred** until a later decision supplies a
business threshold or an explicitly accepted forecasting context.

Candidate inputs:

- Units or explicitly named Sales-amount velocity in a fixed lookback
- Percentile within comparable category/branch
- Days since last sale
- Stock coverage
- Minimum transaction/data count

- Status: **Deferred**; `OQ-011` is not a license to choose an arbitrary threshold.
- Prohibited: hard-code arbitrary global thresholds in different features.
- The `stock-risk-v1` 7/60-day coverage thresholds do not classify movement speed;
  P6-M3-T02 emits neither `FAST_MOVING` nor `SLOW_MOVING`.

### M-104 Low-stock state

StockWise V1 `LOW_STOCK` is a fixed, page-current Branch/Product coverage
classification: valid M-102 `coverageDays <= 7.00`, under `stock-risk-v1`.
It is not a manual reorder point, safety stock, a forecast, or a purchase-quantity
recommendation. The threshold is system-wide and not configurable by Organization,
Branch, or Product; it requires no persisted threshold/configuration field.

- Status: **Accepted** by `ADR-030` for P6-M3-T02, subject to the common
  classification/null contract below. A future reorder-point or forecast/lead-time
  low-stock policy requires a separate decision.
- Factual `outOfStockProductCount` remains the count of active
  Organization Products with current Branch on-hand exactly `0.0000`; an absent lazy
  balance row is zero. Inactive Products are excluded. Zero current stock with valid
  `coverageDays = 0.00` is `LOW_STOCK`, never a `STOCKOUT_RISK` prediction.

### M-105 Stockout risk

Proposed deterministic shape for horizon `H`:

```text
ProjectedAvailable = OnHand + IncomingConfirmed(H)
ProjectedDemand = separately accepted demand estimate for H
ProjectedEnding = ProjectedAvailable - ProjectedDemand
StockoutRisk = ProjectedEnding < SafetyStock
```

An optional estimated stockout date would require a separately accepted policy
for cumulative forecast, incoming stock, and safety stock.

- Status: **Blocked** pending a separate stockout-risk and safety-stock decision,
  outside P6-M3-T02 and `ADR-031`. Forecasting V1 supplies only observed-sale
  quantity estimates; current on-hand equal to zero is only a factual state.
  No-negative stock follows `ADR-024`.
- `forecast-sale-mean-28d-v1` cannot be inserted as uncensored
  `ProjectedDemand` without accepting how stockout-censored observed sales,
  horizon alignment, and current/incoming stock affect the risk calculation.
- The LLM must never assign this risk.

### M-106 Overstock risk

StockWise V1 `OVERSTOCK` is a fixed, page-current Branch/Product coverage
classification: valid M-102 `coverageDays >= 60.00`, under `stock-risk-v1`.
It is neither forecast- nor cost-based and is not configurable by Organization,
Branch, or Product. Null coverage never produces `OVERSTOCK`.

- Status: **Accepted** by `ADR-030` for P6-M3-T02, subject to the common
  classification/null contract below. Forecast-based overstock policy remains
  deferred pending a separate decision.

### P6-M3-T02 internal stock classification contract

P6-M3-T02 composes one `stockClassification` object onto each existing T01
Branch/Product dimension. It does not create a separate page, cursor, summary,
historical bucket series, rank, severity order, alert priority, or Top-N result.
Its sole classification input is that dimension's already calculated M-102
`coverageDays.value`, interpreted with exact Decimal comparison; do not recompute
coverage or substitute requested-period ADS, movement quantity, stock alone,
cost/value, category, or forecast demand. `Product.status` is only the inactive
applicability gate. Product base units remain separate.
For an active Product with valid coverage:

| Exact `coverageDays` boundary | `stockClassification.classification` |
| --- | --- |
| `<= 7.00` | `LOW_STOCK` |
| `> 7.00` and `< 60.00` | `NORMAL` |
| `>= 60.00` | `OVERSTOCK` |

`stockClassification` contains `classification: LOW_STOCK | NORMAL | OVERSTOCK | null`,
`reason: INSUFFICIENT_DATA | NO_RECENT_DEMAND | NO_STOCK_AND_NO_DEMAND |
INVENTORY_INTEGRITY_ERROR | INACTIVE_PRODUCT | null`, and
`thresholdVersion: "stock-risk-v1"`. A valid active-Product result has a non-null
classification and null reason. A null `coverageDays.value` yields null
classification and preserves its T01 reason; neither no-recent-demand reason maps
to a stock label or fabricated coverage. An inactive Product yields null
classification and `INACTIVE_PRODUCT` before considering its coverage reason; T01
movement/history facts remain visible. No equivalent inactive-classification reason
exists in the current analytics contract.

Fixtures must distinguish `0.00` and `7.00` as `LOW_STOCK`, `7.01` and `59.99`
as `NORMAL`, and `60.00` and `60.01` as `OVERSTOCK`. They must
cover each null reason, inactive Product precedence, positive velocity with zero
on-hand, `INVENTORY_STAFF` access without cost permission, `CASHIER` denial, and
absence of forecast, ranking, and Top-N dependencies. Decimal strings and exact
Decimal comparisons are authoritative; JavaScript `number` is not.

The classification is page-current: it inherits the T01 row's cursor-bound event
`sourceCutoff` for 28-day velocity and page-specific `currentSnapshotCapturedAt`
for on-hand/coverage. It reuses T01 Branch ID/Product ID ascending dimension
pagination, opaque cursor, authorized scope, and all temporal limitations. Later
pages may observe newer current stock; no historical risk series or stock
reconstruction is claimed. `INVENTORY_ANALYTICS_VIEW` governs access;
`SALES_COST_VIEW` is not required, and classification never exposes cost/value
fields by itself. P6-M3-T03 owns HTTP/API/UI exposure. This fixed threshold
decision requires no schema, migration, or configuration storage. `ADR-031`
separately defines Forecasting V1; `STOCKOUT_RISK`, safety stock, and reorder
remain undecided.

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

- Status: **Blocked** pending a separate P6-M4-T03 replenishment decision;
  `ADR-031` supplies a seven-day forecast but no lead-time demand policy.
  Quantity representation is accepted by `ADR-022`; Purchase Order lifecycle
  follows `ADR-026`, but expected-arrival/confirmed-incoming semantics are not set.
- `ForecastDemandDuringLeadTime` is an unresolved input, not a conversion of
  the seven-day observed-sale forecast to any supplier lead time.
- Must decide lead-time source, safety-stock formula, whether/when an `ORDERED`
  PO counts as incoming, order multiples, minimum order quantity, and
  unavailable-data behavior.
- Output is a recommendation, not an automatic purchase order.

### M-108 Current on-hand and movement summary

- Status: **Accepted**.
- Current on-hand is `InventoryBalance.quantity` per Branch/Product in the current
  projection read identified by `currentSnapshotCapturedAt`; an absent lazy balance
  row is `0.0000`. It is not an arbitrary historical quantity at `sourceCutoff`.
  Organization/category views return Product/per-unit breakdowns, never a mixed-unit
  scalar.
- Period movement facts come from immutable InventoryTransaction rows at `occurredAt`:
  `purchaseReceivedQuantity` from positive `PURCHASE_RECEIVE`,
  `saleDepletionQuantity` from absolute negative `SALE`,
  `refundReturnQuantity` from positive `SALE_REFUND_RETURN`,
  `positiveAdjustmentQuantity` from positive `MANUAL_ADJUSTMENT`, and
  `negativeAdjustmentQuantity` from absolute negative `MANUAL_ADJUSTMENT`. Do not net
  sources into an opaque accepted movement number.
- A receiving summary may also count PurchaseReceipts by `receivedAt`; that document
  count is separate from item/ledger quantities.

### M-109 Current inventory value

- Status: **Accepted** for the current projection read only; V1 does not claim
  historical point-in-time valuation at an earlier event `sourceCutoff` from mutable
  current cost-state rows.
- Per Branch/Product, persisted KNOWN `InventoryCostState.inventoryValue` is authority.
  Do not recompute value as quantity times the six-decimal displayed average because
  `ADR-026` retains ten-decimal exact value separately. An absent cost-state row is
  UNKNOWN, not a zero-cost known state.
- Positive on-hand with UNKNOWN cost makes total `inventoryValue` null. Return
  `knownInventoryValue`, `knownCostProductCount`, `unknownCostProductCount`, and
  unknown quantity by base unit. Zero on-hand with UNKNOWN cost does not make current
  value incomplete because its contribution is exactly zero.
- Current inventory value and all cost-derived analytics require existing
  `SALES_COST_VIEW` in addition to the relevant analytics permission. V1 reuses this
  centralized cost gate rather than adding a second analytics-cost role matrix.

### M-110 Inventory availability facts

- Status: **Accepted** for `activeProductCount`, `inStockProductCount` (`onHand > 0`),
  and `outOfStockProductCount` (`onHand = 0`) over all active Organization Products at
  one Branch/current projection read. An absent lazy balance is zero. Inactive
  Products are excluded from these counts, including those with historical movements
  or a current projection row.
- M-110 counts remain factual. `ADR-030` separately accepts page-current
  Branch/Product low/normal/overstock coverage classification; stockout risk,
  safety stock, and reorder remain blocked. A factual zero balance must not be
  relabeled as forecast risk.

### P6-M3-T01 internal inventory result contract

P6-M3-T01 computes factual results internally; P6-M3-T03 owns HTTP/UI exposure. One
result has a paginated Branch/Product dimension page and a separate current Branch
summary for every authorized Branch. Each dimension is keyed by `(Branch.id,
Product.id)`, includes the Product's immutable base unit and current name/status, and
contains every requested canonical bucket in ascending order, including zero-movement
buckets. Product metadata is current, not a historical snapshot. A dimension is
eligible if it has a movement in the requested period, has a current balance/cost
projection row, or is an active Organization Product needed for M-110 at that Branch.
Consequently an active Product with no balance row appears with zero on-hand, while
an inactive Product appears only when movement or current state makes it relevant.

Each movement bucket contains only M-108's `purchaseReceivedQuantity`,
`saleDepletionQuantity`, `refundReturnQuantity`, `positiveAdjustmentQuantity`, and
`negativeAdjustmentQuantity`, all in that Product's base unit. The dimension also
contains **separate** nullable requested-period M-008 ADS and M-101 28-day
`coverageSalesVelocity`, named `requestedPeriodAds` and
`coverageSalesVelocity` respectively, plus page-current `onHandQuantity` and
M-102 `coverageDays` with an explicit null reason. Only when `canViewCost` does it
include M-109 `inventoryValue` and known-value/cost-coverage fields. A positive
UNKNOWN quantity makes `inventoryValue` null with `INCOMPLETE_COST_COVERAGE`;
zero-on-hand UNKNOWN contributes `0.0000000000`. Requested-period ADS sums
SALE depletion over the requested canonical period and divides by its complete local
calendar days; if any requested part is partial, return null/`INCOMPLETE_PERIOD`.
It is not substituted for the fixed 28-day coverage velocity. Quantity calculations
use exact Decimal, retain four-place Product-unit precision, and never add unlike
units into a Branch/Organization scalar. Coverage days round HALF_UP to two places.

The separate current Branch summary covers every authorized Branch, even one with
no selected Product dimensions on a page. It contains exactly M-110's active,
in-stock, and out-of-stock Product counts over all active Organization Products,
not just the current page. When cost is authorized, it also contains M-109's current
total `inventoryValue` (null/`INCOMPLETE_COST_COVERAGE` if any positive UNKNOWN stock),
`knownInventoryValue`, known/unknown cost Product counts, and unknown quantity
broken down by base unit across the Branch's current stock, including inactive
Products that still hold stock. Cost coverage counts and unknown quantity cover
positive-on-hand Products; zero-on-hand UNKNOWN contributes exact zero to value and
does not make it incomplete. Monetary values use the persisted ten-decimal
`InventoryCostState.inventoryValue`; never derive them by multiplying a rounded
average. No count implies a low-stock or risk classification.

Branch/Product dimensions sort by `Branch.id ASC, Product.id ASC` and use internal
opaque keyset pagination, default limit 25 and maximum 100. Pagination selects
dimensions, never buckets; each selected dimension carries its full bucket series
and one current snapshot. The signed cursor binds its cursor/version and inventory
dimension identity, `analytics-v1`, Organization, sorted reauthorized Branch set,
local `from`/`to`, granularity, reporting timezone and UTC bounds, the sort tuple,
and the original event `sourceCutoff`. Invalid or mismatched cursors fail; scope is
reauthorized before continuation. Cursor continuation preserves event predicates
and their original cutoff, not a persisted fact snapshot: a later committed fact
with an earlier authoritative `occurredAt` can still change a later page. It does
not freeze current Product metadata, dimension eligibility, or mutable balance/cost
state. Each page reports its own `currentSnapshotCapturedAt`.

For an inventory page, establish one transactionally consistent PostgreSQL read
snapshot and capture server-generated event `sourceCutoff` (first page) and
`currentSnapshotCapturedAt` as part of that execution. Apply `occurredAt <=
sourceCutoff` and half-open UTC bucket bounds to movement and velocity facts. Read
balances, cost states, Product metadata, availability summaries, and reconciliation
facts in the same read snapshot. On continuation, retain the signed original
`sourceCutoff` for event facts and capture a new `currentSnapshotCapturedAt` for
current projections. Both timestamps identify different semantics: the latter is
a page-current read marker, not a claim that mutable projections can be reconstructed
as historical state at the former. No client supplies either timestamp. The
current state can change between pages, including the M-102 numerator and Branch
summary; the 28-day denominator remains anchored to the original event cutoff.

Within the page's read snapshot, compare each current Branch/Product balance (or
implicit zero) to the signed sum of all visible ledger deltas for that pair. This
current-state reconciliation does not filter that sum to the event `sourceCutoff`;
the projection may include a visible movement whose `occurredAt` is later. A
negative balance or mismatch makes affected coverage null with
`INVENTORY_INTEGRITY_ERROR`, and the raw inconsistency remains test-visible.
Impossible KNOWN/UNKNOWN cost-state shapes make affected value unavailable with
the same reason, never a fabricated zero. Source-separated movement quantities
must reconcile to the underlying signed ledger; each positive receipt movement,
negative Sale movement, and positive refund-return movement must match its unique
same-scope source item and quantity. A financial-only zero-restock refund has no
return movement. Positive/negative manual adjustments remain separate. These
invariants are checked without mixing Product units; no transfer source exists.

The query uses `InventoryTransaction`, `Product`, `InventoryBalance`,
`InventoryCostState`, and the existing authorized Branch resolver with set-based
PostgreSQL aggregation. It adds no per-Product/Branch/bucket query, index, migration,
warehouse, materialized view, or rollup by default. `ADR-030` separately accepts
fixed low/normal/overstock coverage classification on these factual outputs;
`ADR-031` separately defines the forecast. Fast/slow, stockout risk,
forecast-derived risk, and reorder still require later accepted definitions.

## 9. Query authority, authorization, and performance

Analytics V1 reads authoritative normalized operational tables directly. It adds no
warehouse, OLAP service, event stream, materialized view, scheduled rollup, or new
summary table. Event facts use one UTC `sourceCutoff` and a transactionally consistent
read snapshot so headers and items cannot straddle different cutoffs. The P6-M3-T01
inventory current-state read has an additional page-specific
`currentSnapshotCapturedAt` under the contract above; the original event cutoff is
preserved across cursor pages without claiming historical balance or valuation.
Reusable persisted snapshots are permitted only in later scheduled-report work or
after measured query evidence; they never replace operational truth.

Authorization is server-derived from the active membership and assignments:

| Output | Required permission/scope |
| --- | --- |
| Sales/discount/VAT/refund/count/AOV/category/branch metrics | `BUSINESS_ANALYTICS_VIEW`; `OWNER`/`ADMIN` Organization-wide, assigned `BRANCH_MANAGER` assigned active Branches |
| Inventory quantity/movement/availability/coverage metrics | `INVENTORY_ANALYTICS_VIEW`; `OWNER`/`ADMIN` Organization-wide, assigned `BRANCH_MANAGER`/`INVENTORY_STAFF` assigned active Branches |
| Forecasting V1 observed-Sale quantity estimates | Existing `FORECAST_REORDER_VIEW`; `OWNER`/`ADMIN` Organization-wide, assigned `BRANCH_MANAGER`/`INVENTORY_STAFF` assigned active Branches; no `SALES_COST_VIEW` |
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

For P6-M2-T02, Category and Branch series are dimension-detail rows and pagination is
part of the internal service contract, not deferred to HTTP exposure. The default page
size is 25 and the maximum is 100. A cursor is opaque and binds the metric definition,
dimension kind, Organization ID, sorted authorized Branch-ID set, `from`, `to`,
granularity, ordering, and source cutoff. Its stable sort tuple is respectively
`(categoryKind, categoryId)` with `UNCATEGORIZED` last, or `(branchId)`; each selected
dimension series contains all requested canonical buckets. A malformed, mismatched, or
unsupported cursor is `INVALID_CURSOR`. A later access-scope change is reauthorized
before cursor use and returns the normal safe forbidden outcome rather than exposing a
previously included Branch. The cursor fixes neither mutable current Category
attribution nor current display labels; direct analytics remains an on-demand view at
its captured cutoff.

P6-M2-T02 uses separate internal Category and Branch repository/service/value
boundaries over the existing analytics context/scope/period engine and P6-M2-T01
Decimal value semantics. Each read uses set-based PostgreSQL aggregation, with no
query per Category or Branch. PostgreSQL returns aggregated dimension/bucket values;
raw SaleItem or SaleRefundItem operational facts are never loaded into Node. Each read
captures a transactionally consistent MVCC snapshot where practical. It adds no HTTP
route, UI, schema, rollup, warehouse, or second cost authorization matrix.

## 10. Trend and seasonal analysis

### Trend

A trend beyond accepted period-over-period Net Sales Growth must name its method,
lookback, grain, and confidence/data status.

- Status: **Deferred** pending a separate trend decision; two-point M-009 growth is
  not labeled a trend. `ADR-031` does not estimate trend.
- Prohibited: label simple two-point growth as a statistically established trend without disclosure.

### Seasonal pattern

Seasonality requires enough comparable cycles and must declare its granularity
(day-of-week, week-of-year, month-of-year) and minimum history.

- Status: **Deferred** for Forecasting V1 by `ADR-031`: no day-of-week, holiday,
  promotion, or other seasonal adjustment is inferred from its 28-day history.
- A future seasonal model requires its own version and evaluation. OpenRouter must
  not infer seasonality from a short snapshot.

## 11. Forecasting V1 contract

**Status: Accepted contract, not implemented.** `ADR-031` resolves `OQ-012` for
P6-M4-T02. The result estimates observed future Sale quantity, not latent customer
demand, revenue, inventory need, or a purchasable reorder quantity.

### Target, grain, time, and inputs

- One series is one authorized Branch/Product pair in the Product's immutable base
  unit. No Organization/Product, Category, or mixed-unit scalar forecast exists in V1.
- For each Organization-local calendar day, the observed target is the sum of
  immutable `SaleItem.quantity` for completed Sales at that Branch and Product whose
  `Sale.completedAt` falls in the day's half-open UTC bounds. A day with no eligible
  SaleItem has exact zero. `Sale.completedAt`, not item creation time or the current
  Product category, determines the day.
- Refund quantity, optional `SALE_REFUND_RETURN` stock, receipts, adjustments,
  price, cost, category, stock, supplier, holidays, promotions, and external data
  are not target adjustments or model features. Later refunds never rewrite a Sale
  training day. A zero-sale stockout day remains observed zero; V1 does not exclude
  it or estimate lost sales. This censoring can understate demand.
- The forecast covers exactly seven daily local-calendar buckets. Its first day
  starts at the first local midnight **at or after** server-captured `sourceCutoff`;
  at an exact midnight it starts that day, otherwise it starts the next day. Daily
  local date labels and IANA-derived half-open UTC bounds are authoritative,
  including DST. Weekly/monthly values are outside V1.
- Training is the 28 complete local days immediately before the local day
  containing `sourceCutoff`. That current day contributes nothing; it is partial
  unless the cutoff is exactly at its opening midnight. At a non-midnight
  cutoff, this leaves an intentional partial-day gap before the
  forecast horizon. Training/horizon bounds and reporting timezone are recorded.
  No client supplies an as-of cutoff to the production calculation.
- The exact Branch/Product must have its earliest visible
  `InventoryTransaction.occurredAt` at or before the training-window start. This
  establishes that the pair existed in inventory context by that boundary, using
  the same conservative marker as M-101. It does **not** establish continuous
  stock availability across the 28 days; Product creation, Branch creation, and
  first SALE alone do not establish this eligibility.
  No minimum positive Sale count is imposed. An eligible all-zero window is a
  genuine zero forecast, not insufficient history.

### `forecast-sale-mean-28d-v1` calculation and output

Let `q_1 ... q_28` be the 28 daily observed Sale quantities, including zero days:

```text
dailyRaw = (sum(q_1 ... q_28)) / 28
forecastDay_k = ROUND_HALF_UP(dailyRaw, 4), for k = 1 ... 7
horizonTotal = sum(forecastDay_1 ... forecastDay_7)
```

Use exact Decimal arithmetic. Daily and total forecasts are non-negative decimal
**expectations** with exactly four fractional places as decimal strings, even for
integer-only `EA`, `PACK`, and `BOX`; no whole-unit rounding occurs here. The total
is the sum of the seven displayed daily values, so it reconciles exactly. Actual
Sale quantities retain the Product unit rules of `ADR-022`. Forecast rounding is
not a sale, inventory mutation, or purchasing quantity rule. Summing these
serialized rounded buckets can differ slightly from rounding seven times the
unrounded daily mean; the serialized-bucket sum is authoritative.

The calculation is recomputed on demand by P6-M4-T02 in the Express/TypeScript
analytics module using set-based normalized PostgreSQL reads, one consistent MVCC
snapshot, and the existing authorization boundary. It needs no new service,
dependency, schema, migration, forecast-output table, model table, training-run
table, scheduler, or persisted forecast. `coverageSalesVelocity` may equal this
mean numerically for an eligible pair, but its inventory-ledger input, purpose,
and page-current coverage context are separate; it is not reused as a forecast
algorithm or as historical training truth. Future persistence needs a measured
query/reproducibility use case and its own decision.

An internal result contains `organizationId`, `branchId`, `productId`, `unit`,
`forecastVersion: "forecast-sale-mean-28d-v1"`, `generatedAt`, `sourceCutoff`,
`reportingTimezone`, `trainingStartInclusive`, `trainingEndExclusive`,
`historyStartAt` (nullable earliest pair movement), `horizonDays: 7`,
`horizonStartInclusive`, `horizonEndExclusive`, and seven ordered `days` with
`localDate`, `bucketStartInclusive`, `bucketEndExclusive`, and `quantity`, plus
`horizonTotal`, `status`, and `reason`. UTC instants are ISO strings; quantities
are decimal strings. `status=AVAILABLE` has seven values, a total, and null
reason. `status=UNAVAILABLE` has no day quantities/total and reason
`INSUFFICIENT_DATA` when the pair lacks 28 complete days, or `INACTIVE_PRODUCT`
when the current Product is inactive; it returns `days: []` and
`horizonTotal: null`, while the training/horizon interval metadata remains
present, and inactive takes precedence. A new Product,
new pair, or pair with no movement is insufficient, never a fabricated zero or
Organization/Category fallback. A sparse but eligible pair is available. Missing
or unauthorized resources use existing safe errors, not a forecast reason.

Use the existing `FORECAST_REORDER_VIEW` capability at the server-derived Branch
scope for this quantity-only result: `OWNER`/`ADMIN` across the Organization and assigned
`BRANCH_MANAGER`/`INVENTORY_STAFF` on active assigned Branches. `CASHIER` has no
access. `SALES_COST_VIEW` is unnecessary because no prices, money, or cost are
returned. P6-M4-T02 must apply that existing policy even if it adapts the
analytics Branch-set resolver, which currently accepts only business/inventory
kinds. P6-M4-T04 owns any later HTTP/UI contract; this section adds none.

### Cutoff, reproducibility, and limitations

Capture `generatedAt`/`sourceCutoff` server-side inside the calculation's read
execution. Eligible Sales and first-movement evidence have event times no later
than `sourceCutoff`; training Sales additionally satisfy
`Sale.completedAt < trainingEndExclusive`. The first-movement marker must be at
or before `trainingStartInclusive`. The snapshot must read Sale, SaleItem,
InventoryTransaction, Organization timezone, Product unit/status, and access
scope consistently. Product unit is immutable; current status is only an
applicability gate, never a historical training feature. Current category and
current stock never enter the calculation.

As in `ADR-029`, event-time `sourceCutoff` is **not** a commit-visibility watermark:
a delayed transaction can become visible later with an earlier event timestamp.
Current Organization timezone changes also re-bucket on-demand history. The
recorded timezone/bounds/version explain a result, but on-demand recomputation
after such changes is not guaranteed byte-identical. No historical Product-status
timeline exists. A future persisted forecast would retain its original inputs;
V1 does not claim an archival replay capability.

## 12. Forecast evaluation metrics

These formulas remain mathematical definitions. `ADR-031` selects E-001 MAE as
Forecasting V1's **primary** metric at one Branch/Product grain. E-002 RMSE and
E-003 WAPE are not V1 acceptance metrics; no secondary metric is required.

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

### Forecasting V1 backtest and acceptance

- Use rolling-origin backtests with four non-overlapping seven-day test windows
  per eligible Branch/Product. For a fixed 56-day fixture ending at local day 56,
  origin midnights are days 28, 35, 42, and 49. Each origin trains on exactly the
  preceding 28 complete local days and predicts the seven days beginning at that
  origin: training/evaluation day indexes are `[0,28)/[28,35)`,
  `[7,35)/[35,42)`, `[14,42)/[42,49)`, and `[21,49)/[49,56)`.
  The evaluation windows do not overlap; training windows may include earlier
  evaluation days once those days precede a later origin. Each origin's actuals
  are its next seven observed daily Sale quantities; no evaluation day enters
  its own training window. The pair's first movement must
  precede or equal each origin's training start. A pair lacking four evaluable
  windows is reported as `INSUFFICIENT_EVALUATION_HISTORY`, not assigned an error
  of zero. Forecast availability itself still requires only 28 days.
- Compare the selected trailing-28-day mean with a named `last-day-naive` reference:
  each of the seven forecast days equals the observed quantity of the last complete
  training day. Compute E-001 MAE over all 28 daily predictions/actuals for each
  pair, including zero-actual days, using exact Decimal errors and HALF_UP to four
  decimal places only for the reported MAE. MAE is defined with a zero actual and
  requires no percentage denominator. Compare within the same Product unit; do not sum or
  average absolute errors across different units. Report per-pair errors,
  eligible/excluded pair counts, and unit-separated distributions, including
  zero-heavy pairs. Do not let high-volume pairs hide sparse ones in one scalar.
- Freeze the fixture, reporting timezone, source event facts, first-movement
  markers, and model version for every run. Time-ordered synthetic fixtures with
  known visibility provide exact regression evidence; a retrospective live-data
  backtest uses one extraction snapshot and event-time origin filters, and must
  disclose that delayed commits cannot be reconstructed as-of past origins.
  Historical Product status is unavailable; use fixed-status fixtures for exact
  tests. A live backtest may select currently active Products but must label this
  cohort selection and never treat current status/category/stock as an origin-time
  model feature. Do not claim historical as-of replay from normalized tables.
- P6-M4-T02 must pass hand-calculated unit fixtures for 28-day sums and zero days,
  27-day/new-pair insufficiency, inactive precedence, four rolling origins,
  cutoff exclusion, a later refund, DST and timezone rebucketing, quantity
  precision, authorization, and deterministic repeat on fixed data. Report both
  model and reference MAE with exclusions. The reference comparison is diagnostic;
  V1 establishes a measured baseline;
  there is no fixed accuracy threshold or requirement for the baseline to beat
  itself or the reference. A later model change requires a new version and a
  separately accepted improvement criterion.

For example, an eligible `EA` pair with 14 units sold across its 28 training
days produces seven `0.5000` daily expectations and `3.5000` total. An eligible
all-zero pair produces seven `0.0000` values and `0.0000` total. A pair whose
first movement is after the training start is `UNAVAILABLE`/
`INSUFFICIENT_DATA` even if it sold recently. A refund in a later day changes
none of those training quantities.

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
currentSnapshotCapturedAt (inventory current-state pages only)
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

- `OQ-017` generation schedule and retries
- `OQ-018` OpenRouter model/fallback/budget/retention
- `OQ-020` performance and retention targets

`OQ-011` and `OQ-016` are resolved by `ADR-029`; `OQ-012` is resolved for
Forecasting V1 by `ADR-031`. `ADR-030` accepts only fixed coverage-based
`LOW_STOCK`/`NORMAL`/`OVERSTOCK` classification. Fast/slow,
`STOCKOUT_RISK`, forecast-derived risk, safety stock, and reorder remain
deferred/blocked until separate accepted decisions. This does not reopen
Analytics V1 metric or timezone semantics.
