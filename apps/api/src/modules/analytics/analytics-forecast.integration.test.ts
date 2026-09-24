import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import { createPrismaForecastRepository } from "./analytics-forecast-repository.ts";
import { createForecastService } from "./analytics-forecast-service.ts";
import { createForecastWindow } from "./analytics-forecast-values.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const cutoff = new Date("2026-09-25T05:00:00.000Z");
const window = createForecastWindow(cutoff, "Asia/Bangkok");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function actor(
  organizationId: string,
  role: "OWNER" | "BRANCH_MANAGER" | "INVENTORY_STAFF" | "CASHIER",
  branchId?: string,
) {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: "test",
      emailVerifiedAt: cutoff,
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId, userId: user.id, role },
  });
  if (branchId !== undefined) {
    await prisma.branchAssignment.create({
      data: { organizationId, userId: user.id, branchId },
    });
  }
  return { user, membership };
}

async function fixture() {
  const org = await prisma.organization.create({
    data: { name: "Forecast", reportingTimezone: "Asia/Bangkok" },
  });
  const branchA = await prisma.branch.create({
    data: { organizationId: org.id, code: "A", name: "A" },
  });
  const branchB = await prisma.branch.create({
    data: { organizationId: org.id, code: "B", name: "B" },
  });
  const owner = await actor(org.id, "OWNER");
  const manager = await actor(org.id, "BRANCH_MANAGER", branchA.id);
  const staff = await actor(org.id, "INVENTORY_STAFF", branchA.id);
  const cashier = await actor(org.id, "CASHIER", branchA.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: "EA",
      name: "Each",
      unit: "EA",
      basePrice: "10",
    },
  });
  return { org, branchA, branchB, owner, manager, staff, cashier, product };
}

async function movement(input: {
  organizationId: string;
  branchId: string;
  productId: string;
  actor: Awaited<ReturnType<typeof actor>>;
  occurredAt: Date;
  source?: string;
}) {
  return prisma.inventoryTransaction.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      productId: input.productId,
      actorUserId: input.actor.user.id,
      actorMembershipId: input.actor.membership.id,
      occurredAt: input.occurredAt,
      delta: "1",
      source: input.source ?? "MANUAL_ADJUSTMENT",
      adjustmentReason: "FOUND",
      idempotencyKeyHash: digest(randomUUID()),
      canonicalRequestHash: digest(randomUUID()),
    },
  });
}

async function sale(input: {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  productUnit: "EA" | "KG";
  actor: Awaited<ReturnType<typeof actor>>;
  completedAt: Date;
  quantity: string;
}) {
  const id = randomUUID();
  const amount = new Prisma.Decimal(input.quantity).times(10).toFixed(2);
  const created = await prisma.sale.create({
    data: {
      id,
      organizationId: input.organizationId,
      branchId: input.branchId,
      actorUserId: input.actor.user.id,
      actorMembershipId: input.actor.membership.id,
      actorDisplayNameSnapshot: "Owner",
      branchCodeSnapshot: input.branchCode,
      branchNameSnapshot: input.branchName,
      organizationNameSnapshot: input.organizationName,
      completedAt: input.completedAt,
      reference: `SALE-${id}`,
      idempotencyKeyHash: digest(id),
      canonicalRequestHash: digest(`${id}-request`),
      subtotalAmount: amount,
      totalAmount: amount,
      outputVatAmount: "0",
      salesVatStatusSnapshot: "NOT_REGISTERED",
    },
  });
  await prisma.saleItem.create({
    data: {
      saleId: created.id,
      organizationId: input.organizationId,
      branchId: input.branchId,
      productId: input.productId,
      productSkuSnapshot: input.productSku,
      productNameSnapshot: input.productName,
      productUnitSnapshot: input.productUnit,
      quantity: input.quantity,
      unitPrice: "10",
      lineGross: amount,
      lineDiscount: "0",
      lineNet: amount,
      lineOutputVat: "0",
      costBasisState: "UNKNOWN",
    },
  });
  return created;
}

function read(
  input: {
    actorUserId: string;
    organizationId: string;
    productId: string;
    branchId?: string;
  },
  at = cutoff,
) {
  const service = createForecastService(
    createPrismaForecastRepository(prisma, { now: () => at }),
  );
  return service.read({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    productId: input.productId,
    scope:
      input.branchId === undefined
        ? { kind: "organization" }
        : { kind: "branch", branchId: input.branchId },
  });
}

describe("Forecasting V1 with normalized PostgreSQL facts", () => {
  beforeEach(async () => resetTestDatabase(environment));
  afterAll(async () => {
    await resetTestDatabase(environment);
    await prisma.$disconnect();
  });

  it("uses Sale.completedAt local bounds, excludes the partial day and future facts, and separates Branches", async () => {
    const f = await fixture();
    for (const branch of [f.branchA, f.branchB]) {
      await movement({
        organizationId: f.org.id,
        branchId: branch.id,
        productId: f.product.id,
        actor: f.owner,
        occurredAt: new Date(window.trainingStartInclusive),
      });
    }
    const createSale = (
      branch: typeof f.branchA,
      completedAt: Date,
      quantity: string,
    ) =>
      sale({
        organizationId: f.org.id,
        organizationName: f.org.name,
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        productId: f.product.id,
        productSku: f.product.sku,
        productName: f.product.name,
        productUnit: "EA",
        actor: f.owner,
        completedAt,
        quantity,
      });
    await createSale(f.branchA, new Date(window.trainingStartInclusive), "1");
    await createSale(f.branchA, new Date("2026-09-24T16:59:59.999Z"), "2");
    await createSale(f.branchA, new Date(window.trainingEndExclusive), "20");
    await createSale(f.branchA, new Date("2026-09-26T00:00:00.000Z"), "30");
    await createSale(f.branchB, new Date("2026-09-24T16:59:59.999Z"), "4");

    const result = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.forecasts).toHaveLength(2);
    const a = result.forecasts.find(
      (forecast) => forecast.branchId === f.branchA.id,
    )!;
    const b = result.forecasts.find(
      (forecast) => forecast.branchId === f.branchB.id,
    )!;
    expect(a).toMatchObject({
      status: "AVAILABLE",
      unit: "EA",
      sourceCutoff: cutoff.toISOString(),
      horizonTotal: "0.7497",
      historyStartAt: window.trainingStartInclusive,
    });
    expect(b).toMatchObject({ status: "AVAILABLE", horizonTotal: "1.0003" });
    if (a.status === "AVAILABLE") expect(a.days[0]?.quantity).toBe("0.1071");
    if (b.status === "AVAILABLE") expect(b.days[0]?.quantity).toBe("0.1429");
  });

  it("applies earliest movement eligibility, zero history, inactive precedence, and current-feature exclusion", async () => {
    const f = await fixture();
    let result = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    expect(result).toMatchObject({
      kind: "success",
      forecasts: [
        {
          status: "UNAVAILABLE",
          reason: "INSUFFICIENT_DATA",
          days: [],
          horizonTotal: null,
        },
      ],
    });
    await movement({
      organizationId: f.org.id,
      branchId: f.branchA.id,
      productId: f.product.id,
      actor: f.owner,
      occurredAt: new Date(
        new Date(window.trainingStartInclusive).getTime() + 1,
      ),
    });
    result = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    expect(result).toMatchObject({
      kind: "success",
      forecasts: [{ status: "UNAVAILABLE", reason: "INSUFFICIENT_DATA" }],
    });
    await movement({
      organizationId: f.org.id,
      branchId: f.branchA.id,
      productId: f.product.id,
      actor: f.owner,
      occurredAt: new Date(window.trainingStartInclusive),
    });
    result = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    expect(result).toMatchObject({
      kind: "success",
      forecasts: [{ status: "AVAILABLE", horizonTotal: "0.0000" }],
    });
    const newCategory = await prisma.category.create({
      data: {
        organizationId: f.org.id,
        name: "New category",
        normalizedName: "new category",
      },
    });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { basePrice: "100", categoryId: newCategory.id },
    });
    await prisma.inventoryBalance.create({
      data: {
        organizationId: f.org.id,
        branchId: f.branchA.id,
        productId: f.product.id,
        quantity: "100",
      },
    });
    const afterFeatures = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    expect(afterFeatures).toMatchObject({
      kind: "success",
      forecasts: [{ status: "AVAILABLE", horizonTotal: "0.0000" }],
    });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { status: "INACTIVE" },
    });
    const inactive = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    expect(inactive).toMatchObject({
      kind: "success",
      forecasts: [
        {
          status: "UNAVAILABLE",
          reason: "INACTIVE_PRODUCT",
          days: [],
          horizonTotal: null,
        },
      ],
    });
  });

  it("does not subtract a later refund or optional restock from the original Sale target", async () => {
    const f = await fixture();
    await movement({
      organizationId: f.org.id,
      branchId: f.branchA.id,
      productId: f.product.id,
      actor: f.owner,
      occurredAt: new Date(window.trainingStartInclusive),
    });
    const original = await sale({
      organizationId: f.org.id,
      organizationName: f.org.name,
      branchId: f.branchA.id,
      branchCode: f.branchA.code,
      branchName: f.branchA.name,
      productId: f.product.id,
      productSku: f.product.sku,
      productName: f.product.name,
      productUnit: "EA",
      actor: f.owner,
      completedAt: new Date("2026-09-10T05:00:00.000Z"),
      quantity: "2",
    });
    const before = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    const refundId = randomUUID();
    await prisma.saleRefund.create({
      data: {
        id: refundId,
        organizationId: f.org.id,
        branchId: f.branchA.id,
        saleId: original.id,
        actorUserId: f.owner.user.id,
        actorMembershipId: f.owner.membership.id,
        actorDisplayNameSnapshot: "Owner",
        reason: "Customer return",
        reference: `REFUND-${refundId}`,
        grossAmount: "10",
        discountAmount: "0",
        totalAmount: "10",
        outputVatAmount: "0",
        salesVatStatusSnapshot: "NOT_REGISTERED",
        idempotencyKeyHash: digest(refundId),
        canonicalRequestHash: digest(`${refundId}-request`),
        completedAt: new Date("2026-09-20T05:00:00.000Z"),
      },
    });
    const originalItem = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: original.id },
    });
    const refundItem = await prisma.saleRefundItem.create({
      data: {
        saleRefundId: refundId,
        saleId: original.id,
        saleItemId: originalItem.id,
        organizationId: f.org.id,
        branchId: f.branchA.id,
        productId: f.product.id,
        refundQuantity: "1",
        restockQuantity: "1",
        reversedLineGross: "10",
        reversedLineDiscount: "0",
        reversedLineNet: "10",
        reversedLineOutputVat: "0",
        originalCostBasisState: "UNKNOWN",
      },
    });
    await prisma.inventoryTransaction.create({
      data: {
        organizationId: f.org.id,
        branchId: f.branchA.id,
        productId: f.product.id,
        actorUserId: f.owner.user.id,
        actorMembershipId: f.owner.membership.id,
        occurredAt: new Date("2026-09-20T05:00:00.000Z"),
        delta: "1",
        source: "SALE_REFUND_RETURN",
        saleRefundItemId: refundItem.id,
      },
    });
    const after = await read({
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    });
    expect(before).toMatchObject({
      kind: "success",
      forecasts: [{ status: "AVAILABLE", horizonTotal: "0.4998" }],
    });
    expect(after).toMatchObject({
      kind: "success",
      forecasts: [{ status: "AVAILABLE", horizonTotal: "0.4998" }],
    });
  });

  it("re-buckets source events after an Organization timezone change", async () => {
    const f = await fixture();
    await movement({
      organizationId: f.org.id,
      branchId: f.branchA.id,
      productId: f.product.id,
      actor: f.owner,
      occurredAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    await sale({
      organizationId: f.org.id,
      organizationName: f.org.name,
      branchId: f.branchA.id,
      branchCode: f.branchA.code,
      branchName: f.branchA.name,
      productId: f.product.id,
      productSku: f.product.sku,
      productName: f.product.name,
      productUnit: "EA",
      actor: f.owner,
      completedAt: new Date("2026-08-28T00:00:00.000Z"),
      quantity: "1",
    });
    const request = {
      actorUserId: f.owner.user.id,
      organizationId: f.org.id,
      productId: f.product.id,
      branchId: f.branchA.id,
    };
    expect(await read(request)).toMatchObject({
      kind: "success",
      forecasts: [
        {
          status: "AVAILABLE",
          horizonTotal: "0.2499",
          reportingTimezone: "Asia/Bangkok",
        },
      ],
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { reportingTimezone: "America/New_York" },
    });
    expect(await read(request)).toMatchObject({
      kind: "success",
      forecasts: [
        {
          status: "AVAILABLE",
          horizonTotal: "0.0000",
          reportingTimezone: "America/New_York",
        },
      ],
    });
  });

  it("enforces FORECAST_REORDER_VIEW without SALES_COST_VIEW", async () => {
    const f = await fixture();
    const base = { organizationId: f.org.id, productId: f.product.id };
    expect((await read({ ...base, actorUserId: f.staff.user.id })).kind).toBe(
      "success",
    );
    const assigned = await read({ ...base, actorUserId: f.staff.user.id });
    if (assigned.kind === "success")
      expect(assigned.forecasts.map((value) => value.branchId)).toEqual([
        f.branchA.id,
      ]);
    expect(
      (
        await read({
          ...base,
          actorUserId: f.manager.user.id,
          branchId: f.branchB.id,
        })
      ).kind,
    ).toBe("forbidden");
    expect((await read({ ...base, actorUserId: f.cashier.user.id })).kind).toBe(
      "forbidden",
    );
    expect(
      (
        await read({
          ...base,
          actorUserId: f.owner.user.id,
          branchId: f.branchB.id,
        })
      ).kind,
    ).toBe("success");
    expect(
      (
        await read({
          ...base,
          actorUserId: f.owner.user.id,
          productId: randomUUID(),
        })
      ).kind,
    ).toBe("not_found");
  });
});
