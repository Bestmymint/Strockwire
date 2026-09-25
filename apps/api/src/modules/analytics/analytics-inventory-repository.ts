import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { AnalyticsExecutionContext } from "./analytics-context.ts";
import {
  InvalidAnalyticsCursorError,
  type AnalyticsDimensionCursorCodec,
} from "./analytics-dimension-cursor.ts";
import { createAnalyticsPeriodContext } from "./analytics-period.ts";
import type { AnalyticsScopeCandidate } from "./analytics-scope.ts";
import { createPrismaAnalyticsScopeRepository } from "./analytics-scope-repository.ts";
import {
  invalidInventoryMovementSql,
  inventorySourceItemErrorsSql,
} from "./analytics-inventory-integrity.ts";
import {
  buildInventoryDimension,
  coverageWindow,
  type InventoryAggregateRow,
  type InventoryCostResult,
  type InventoryDimension,
} from "./analytics-inventory-values.ts";

export interface InventoryBranchSummary {
  branchId: string;
  branchName: string;
  branchStatus: "ACTIVE" | "INACTIVE";
  activeProductCount: number;
  inStockProductCount: number;
  outOfStockProductCount: number;
  cost?: InventoryCostResult;
}

export interface AnalyticsInventoryPage {
  context: AnalyticsExecutionContext;
  metricDefinitionVersion: "analytics-v1";
  currentSnapshotCapturedAt: Date;
  nextCursor: string | null;
  series: readonly InventoryDimension[];
  branches: readonly InventoryBranchSummary[];
}

export interface AnalyticsInventoryRepository {
  read(
    context: AnalyticsExecutionContext,
    limit: number,
    after: { branchId: string; productId: string } | null,
    continuation: boolean,
    actorUserId: string,
    candidate: AnalyticsScopeCandidate,
  ): Promise<AnalyticsInventoryPage>;
}

interface SummaryRow {
  branchId: string;
  branchName: string;
  branchStatus: "ACTIVE" | "INACTIVE";
  activeCount: bigint;
  inStockCount: bigint;
  outOfStockCount: bigint;
  knownValue: Prisma.Decimal;
  knownCount: bigint;
  unknownCount: bigint;
  invalidCostCount: bigint;
  unknownUnit: string | null;
  unknownQuantity: Prisma.Decimal | null;
}

function safeCount(count: bigint): number {
  const value = Number(count);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Inventory count out of range.");
  return value;
}

export function createPrismaAnalyticsInventoryRepository(
  prisma: Pick<PrismaClient, "$transaction">,
  cursorCodec: AnalyticsDimensionCursorCodec,
  options: {
    now?: () => Date;
    afterSnapshotCaptured?: () => Promise<void>;
  } = {},
): AnalyticsInventoryRepository {
  return {
    async read(
      initialContext,
      limit,
      after,
      continuation,
      actorUserId,
      candidate,
    ) {
      // The first statement establishes the REPEATABLE READ snapshot. Capture
      // database time during that statement, after its snapshot is established.
      return prisma.$transaction(
        async (tx) => {
          const captured = await tx.$queryRaw<{ capturedAt: Date }[]>(
            options.now === undefined
              ? Prisma.sql`SELECT clock_timestamp() AS "capturedAt"`
              : Prisma.sql`SELECT ${options.now()}::timestamptz AS "capturedAt"`,
          );
          const currentSnapshotCapturedAt = captured[0]!.capturedAt;
          await options.afterSnapshotCaptured?.();
          const currentScope = await createPrismaAnalyticsScopeRepository(
            tx,
          ).resolve({
            actorUserId,
            analyticsKind: "inventory",
            candidate,
            organizationId: initialContext.scope.organizationId,
          });
          if (
            currentScope.kind !== "success" ||
            currentScope.reportingTimezone !==
              initialContext.period.reportingTimezone ||
            currentScope.scope.branchIds.join("\n") !==
              initialContext.scope.branchIds.join("\n") ||
            currentScope.scope.canViewCost !== initialContext.scope.canViewCost
          ) {
            throw new InvalidAnalyticsCursorError();
          }
          const context: AnalyticsExecutionContext = continuation
            ? initialContext
            : {
                scope: initialContext.scope,
                period: createAnalyticsPeriodContext({
                  from: initialContext.period.from,
                  to: initialContext.period.to,
                  granularity: initialContext.period.granularity,
                  reportingTimezone: initialContext.period.reportingTimezone,
                  sourceCutoff: currentSnapshotCapturedAt,
                }),
              };
          const branchIds = context.scope.branchIds.map(
            (id) => Prisma.sql`${id}::uuid`,
          );
          const organizationId = context.scope.organizationId;
          const cutoff = context.period.sourceCutoff;
          const start = context.period.periodStartInclusive;
          const end = context.period.periodEndExclusive;
          const lookback = coverageWindow(context.period);
          const costJoin = context.scope.canViewCost
            ? Prisma.sql`LEFT JOIN inventory_cost_states AS costs ON costs.organization_id = ${organizationId}::uuid
              AND costs.branch_id = branch.id AND costs.product_id = product.id`
            : Prisma.empty;
          const costState = context.scope.canViewCost
            ? Prisma.sql`costs.basis_state::text`
            : Prisma.sql`NULL::text`;
          const costValue = context.scope.canViewCost
            ? Prisma.sql`costs.inventory_value`
            : Prisma.sql`NULL::numeric`;
          const costAverage = context.scope.canViewCost
            ? Prisma.sql`costs.average_unit_cost`
            : Prisma.sql`NULL::numeric`;

          const summaryRows = await tx.$queryRaw<SummaryRow[]>(Prisma.sql`
          WITH pairs AS (
            SELECT branch.id AS branch_id, branch.name AS branch_name,
              branch.status::text AS branch_status, product.status::text AS product_status,
              product.unit::text AS product_unit,
              COALESCE(balance.quantity, 0)::numeric AS on_hand,
              ${costState} AS cost_state, ${costValue} AS cost_value,
              ${costAverage} AS cost_average
            FROM branches AS branch
            CROSS JOIN products AS product
            LEFT JOIN inventory_balances AS balance ON balance.organization_id = ${organizationId}::uuid
              AND balance.branch_id = branch.id AND balance.product_id = product.id
            ${costJoin}
            WHERE branch.organization_id = ${organizationId}::uuid
              AND branch.id IN (${Prisma.join(branchIds)})
              AND product.organization_id = ${organizationId}::uuid
          ), totals AS (
            SELECT branch_id,
              COUNT(*) FILTER (WHERE product_status = 'ACTIVE')::bigint AS active_count,
              COUNT(*) FILTER (WHERE product_status = 'ACTIVE' AND on_hand > 0)::bigint AS in_stock_count,
              COUNT(*) FILTER (WHERE product_status = 'ACTIVE' AND on_hand = 0)::bigint AS out_of_stock_count,
              COALESCE(SUM(cost_value) FILTER (WHERE on_hand > 0 AND cost_state = 'KNOWN'
                AND cost_value IS NOT NULL AND cost_average IS NOT NULL
                AND cost_value >= 0 AND cost_average >= 0), 0)::numeric AS known_value,
              COUNT(*) FILTER (WHERE on_hand > 0 AND cost_state = 'KNOWN'
                AND cost_value IS NOT NULL AND cost_average IS NOT NULL
                AND cost_value >= 0 AND cost_average >= 0)::bigint AS known_count,
              COUNT(*) FILTER (WHERE on_hand > 0 AND (cost_state IS NULL OR cost_state = 'UNKNOWN'))::bigint AS unknown_count,
              COUNT(*) FILTER (WHERE (cost_state = 'KNOWN' AND
                (cost_value IS NULL OR cost_average IS NULL OR cost_value < 0 OR cost_average < 0
                  OR (on_hand = 0 AND cost_value <> 0)))
                OR (cost_state = 'UNKNOWN' AND (cost_value IS NOT NULL OR cost_average IS NOT NULL)))::bigint AS invalid_cost_count
            FROM pairs GROUP BY branch_id
          ), unknown_units AS (
            SELECT branch_id, product_unit,
              SUM(on_hand)::numeric AS quantity
            FROM pairs WHERE on_hand > 0 AND (cost_state IS NULL OR cost_state = 'UNKNOWN')
            GROUP BY branch_id, product_unit
          )
          SELECT branch.id::text AS "branchId", branch.name AS "branchName",
            branch.status::text AS "branchStatus",
            COALESCE(totals.active_count, 0)::bigint AS "activeCount",
            COALESCE(totals.in_stock_count, 0)::bigint AS "inStockCount",
            COALESCE(totals.out_of_stock_count, 0)::bigint AS "outOfStockCount",
            COALESCE(totals.known_value, 0)::numeric AS "knownValue",
            COALESCE(totals.known_count, 0)::bigint AS "knownCount",
            COALESCE(totals.unknown_count, 0)::bigint AS "unknownCount",
            COALESCE(totals.invalid_cost_count, 0)::bigint AS "invalidCostCount",
            unknown_units.product_unit AS "unknownUnit",
            unknown_units.quantity AS "unknownQuantity"
          FROM branches AS branch
          LEFT JOIN totals ON totals.branch_id = branch.id
          LEFT JOIN unknown_units ON unknown_units.branch_id = branch.id
          WHERE branch.organization_id = ${organizationId}::uuid
            AND branch.id IN (${Prisma.join(branchIds)})
          ORDER BY branch.id, unknown_units.product_unit
        `);
          const branchGroups = new Map<string, SummaryRow[]>();
          for (const row of summaryRows) {
            const group = branchGroups.get(row.branchId) ?? [];
            group.push(row);
            branchGroups.set(row.branchId, group);
          }
          const branches: InventoryBranchSummary[] = [
            ...branchGroups.values(),
          ].map((rows) => {
            const row = rows[0]!;
            const summary: InventoryBranchSummary = {
              branchId: row.branchId,
              branchName: row.branchName,
              branchStatus: row.branchStatus,
              activeProductCount: safeCount(row.activeCount),
              inStockProductCount: safeCount(row.inStockCount),
              outOfStockProductCount: safeCount(row.outOfStockCount),
            };
            if (context.scope.canViewCost) {
              const unknownQuantityByUnit: Record<string, string> = {};
              for (const unitRow of rows)
                if (
                  unitRow.unknownUnit !== null &&
                  unitRow.unknownQuantity !== null
                )
                  unknownQuantityByUnit[unitRow.unknownUnit] =
                    unitRow.unknownQuantity.toFixed(4);
              const reason =
                row.invalidCostCount > 0n
                  ? ("INVENTORY_INTEGRITY_ERROR" as const)
                  : row.unknownCount > 0n
                    ? ("INCOMPLETE_COST_COVERAGE" as const)
                    : null;
              const knownInventoryValue = row.knownValue.toFixed(10);
              summary.cost = {
                inventoryValue: {
                  value: reason === null ? knownInventoryValue : null,
                  reason,
                },
                knownInventoryValue,
                knownCostProductCount: safeCount(row.knownCount),
                unknownCostProductCount: safeCount(row.unknownCount),
                unknownQuantityByUnit,
              };
            }
            return summary;
          });

          const bounds = context.period.buckets.map(
            (bucket, index) => Prisma.sql`(
          ${index}::integer, ${bucket.bucketStartInclusive}::timestamptz,
          ${bucket.bucketEndExclusive}::timestamptz)`,
          );
          const pageCostJoin = context.scope.canViewCost
            ? Prisma.sql`LEFT JOIN inventory_cost_states AS costs ON costs.organization_id = ${organizationId}::uuid
              AND costs.branch_id = page.branch_id AND costs.product_id = page.product_id`
            : Prisma.empty;
          const pageCostState = context.scope.canViewCost
            ? Prisma.sql`costs.basis_state::text`
            : Prisma.sql`NULL::text`;
          const pageCostValue = context.scope.canViewCost
            ? Prisma.sql`costs.inventory_value`
            : Prisma.sql`NULL::numeric`;
          const pageCostAverage = context.scope.canViewCost
            ? Prisma.sql`costs.average_unit_cost`
            : Prisma.sql`NULL::numeric`;
          const rows = await tx.$queryRaw<InventoryAggregateRow[]>(Prisma.sql`
          WITH bucket_bounds (bucket_index, start_inclusive, end_exclusive) AS (
            VALUES ${Prisma.join(bounds)}
          ), candidates AS (
            SELECT branch.id AS branch_id, product.id AS product_id,
              branch.name AS branch_name, branch.status::text AS branch_status,
              product.name AS product_name, product.status::text AS product_status,
              product.unit::text AS product_unit
            FROM branches AS branch CROSS JOIN products AS product
            WHERE branch.organization_id = ${organizationId}::uuid
              AND branch.id IN (${Prisma.join(branchIds)})
              AND product.organization_id = ${organizationId}::uuid
              AND (product.status = 'ACTIVE'
                OR EXISTS (SELECT 1 FROM inventory_balances AS b WHERE b.branch_id = branch.id AND b.product_id = product.id)
                OR EXISTS (SELECT 1 FROM inventory_cost_states AS c WHERE c.branch_id = branch.id AND c.product_id = product.id)
                OR EXISTS (SELECT 1 FROM inventory_transactions AS t WHERE t.branch_id = branch.id
                  AND t.product_id = product.id AND t.occurred_at >= ${start}::timestamptz
                  AND t.occurred_at < ${end}::timestamptz AND t.occurred_at <= ${cutoff}::timestamptz))
          ), page AS (
            SELECT * FROM candidates
            WHERE (${after?.branchId ?? null}::uuid IS NULL OR
              (branch_id, product_id) > (${after?.branchId ?? null}::uuid, ${after?.productId ?? null}::uuid))
            ORDER BY branch_id, product_id LIMIT ${limit + 1}
          ), ledger AS (
            SELECT page.branch_id, page.product_id,
              COALESCE(SUM(t.delta), 0)::numeric AS ledger_quantity,
              MIN(t.occurred_at) FILTER (WHERE t.occurred_at <= ${cutoff}::timestamptz) AS first_movement_at,
              COALESCE(SUM(-t.delta) FILTER (WHERE t.source = 'SALE' AND t.delta < 0
                AND t.occurred_at >= ${start}::timestamptz AND t.occurred_at < ${end}::timestamptz
                AND t.occurred_at <= ${cutoff}::timestamptz), 0)::numeric AS period_sale,
              COALESCE(SUM(-t.delta) FILTER (WHERE t.source = 'SALE' AND t.delta < 0
                AND t.occurred_at >= ${lookback.start}::timestamptz AND t.occurred_at < ${lookback.end}::timestamptz
                AND t.occurred_at <= ${cutoff}::timestamptz), 0)::numeric AS coverage_sale,
              COUNT(t.id) FILTER (WHERE ${invalidInventoryMovementSql})::bigint AS invalid_source_count
            FROM page
            LEFT JOIN inventory_transactions AS t ON t.organization_id = ${organizationId}::uuid
              AND t.branch_id = page.branch_id AND t.product_id = page.product_id
            LEFT JOIN purchase_receipt_items AS r ON r.id = t.purchase_receipt_item_id
              AND r.organization_id = t.organization_id AND r.branch_id = t.branch_id AND r.product_id = t.product_id
            LEFT JOIN sale_items AS s ON s.id = t.sale_item_id
              AND s.organization_id = t.organization_id AND s.branch_id = t.branch_id AND s.product_id = t.product_id
            LEFT JOIN sale_refund_items AS f ON f.id = t.sale_refund_item_id
              AND f.organization_id = t.organization_id AND f.branch_id = t.branch_id AND f.product_id = t.product_id
            GROUP BY page.branch_id, page.product_id
          ), ${inventorySourceItemErrorsSql(organizationId)}, movement AS (
            SELECT page.branch_id, page.product_id, buckets.bucket_index,
              COALESCE(SUM(t.delta) FILTER (WHERE t.source = 'PURCHASE_RECEIVE' AND t.delta > 0), 0)::numeric AS received,
              COALESCE(SUM(-t.delta) FILTER (WHERE t.source = 'SALE' AND t.delta < 0), 0)::numeric AS depleted,
              COALESCE(SUM(t.delta) FILTER (WHERE t.source = 'SALE_REFUND_RETURN' AND t.delta > 0), 0)::numeric AS returned,
              COALESCE(SUM(t.delta) FILTER (WHERE t.source = 'MANUAL_ADJUSTMENT' AND t.delta > 0), 0)::numeric AS positive_adjustment,
              COALESCE(SUM(-t.delta) FILTER (WHERE t.source = 'MANUAL_ADJUSTMENT' AND t.delta < 0), 0)::numeric AS negative_adjustment
            FROM page CROSS JOIN bucket_bounds AS buckets
            LEFT JOIN inventory_transactions AS t ON t.organization_id = ${organizationId}::uuid
              AND t.branch_id = page.branch_id AND t.product_id = page.product_id
              AND t.occurred_at >= buckets.start_inclusive AND t.occurred_at < buckets.end_exclusive
              AND t.occurred_at <= ${cutoff}::timestamptz
            GROUP BY page.branch_id, page.product_id, buckets.bucket_index
          )
          SELECT page.branch_id::text AS "branchId", page.branch_name AS "branchName",
            page.branch_status AS "branchStatus", page.product_id::text AS "productId",
            page.product_name AS "productName", page.product_status AS "productStatus",
            page.product_unit AS "productUnit", movement.bucket_index AS "bucketIndex",
            movement.received AS "purchaseReceived", movement.depleted AS "saleDepletion",
            movement.returned AS "refundReturn", movement.positive_adjustment AS "positiveAdjustment",
            movement.negative_adjustment AS "negativeAdjustment", ledger.period_sale AS "periodSaleDepletion",
            ledger.coverage_sale AS "coverageSaleDepletion", ledger.first_movement_at AS "firstMovementAt",
            COALESCE(balance.quantity, 0)::numeric AS "onHand", ledger.ledger_quantity AS "ledgerQuantity",
            (ledger.invalid_source_count + source_item_errors.error_count)::bigint AS "invalidSourceCount",
            ${pageCostState} AS "costBasisState", ${pageCostValue} AS "costInventoryValue",
            ${pageCostAverage} AS "costAverageUnitCost"
          FROM page
          JOIN ledger ON ledger.branch_id = page.branch_id AND ledger.product_id = page.product_id
          JOIN source_item_errors ON source_item_errors.branch_id = page.branch_id
            AND source_item_errors.product_id = page.product_id
          JOIN movement ON movement.branch_id = page.branch_id AND movement.product_id = page.product_id
          LEFT JOIN inventory_balances AS balance ON balance.organization_id = ${organizationId}::uuid
            AND balance.branch_id = page.branch_id AND balance.product_id = page.product_id
          ${pageCostJoin}
          ORDER BY page.branch_id, page.product_id, movement.bucket_index
        `);
          const groups = new Map<string, InventoryAggregateRow[]>();
          for (const row of rows) {
            const key = `${row.branchId}/${row.productId}`;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
          }
          const allGroups = [...groups.values()];
          const selected = allGroups.slice(0, limit);
          const last = selected.at(-1)?.[0];
          return {
            context,
            metricDefinitionVersion: "analytics-v1" as const,
            currentSnapshotCapturedAt,
            nextCursor:
              allGroups.length > limit && last !== undefined
                ? cursorCodec.encode({
                    context,
                    dimension: "inventory",
                    lastId: null,
                    lastBranchId: last.branchId,
                    lastProductId: last.productId,
                  })
                : null,
            series: selected.map((group) =>
              buildInventoryDimension({
                rows: group,
                period: context.period,
                canViewCost: context.scope.canViewCost,
              }),
            ),
            branches,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
  };
}
