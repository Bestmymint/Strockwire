"use client";
import { useLanguage } from "@/providers/language-provider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatThb } from "@/money-display";
import { SaleReceipt } from "@/components/sale-receipt";
import {
  applicationContextUrl,
  resolveApplicationContext,
} from "@/application-context";
import {
  type AccessibleOrganization,
  fetchAccessContext,
} from "@/branch-api-client";
import {
  createSaleRefund,
  getSalesHistoryDetail,
  listSalesHistory,
  type SalesApiErrorKind,
  SalesApiError,
  type SalesHistoryDetail,
  type SalesHistorySummary,
  type SalesRequestContext,
} from "@/sales-api-client";

type SalesHistoryRole = AccessibleOrganization["role"];
type SalesHistoryPage = Awaited<ReturnType<typeof listSalesHistory>>;

const HISTORY_ROLES = new Set<SalesHistoryRole>([
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
  "CASHIER",
]);
const REFUND_CREATE_ROLES = new Set<SalesHistoryRole>([
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function salesUrl(organizationId: string, branchId: string | null): string {
  const params = new URLSearchParams({ organizationId });
  if (branchId !== null) params.set("branchId", branchId);
  return `/app/sales?${params.toString()}`;
}

function salesScopeKey(context: SalesRequestContext): readonly unknown[] {
  return ["branch-scoped", context.organizationId, context.branchId, "sales"];
}

function formatAbsoluteTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function errorMessage(error: unknown): string {
  if (!(error instanceof SalesApiError)) {
    return "Sales history is temporarily unavailable. Try again.";
  }
  const messages: Record<SalesApiErrorKind, string> = {
    authentication_required: "Sign in again to view sales history.",
    branch_inactive: "This branch is inactive.",
    forbidden: "Sales history is not available for your current access.",
    idempotency_conflict:
      "Sales history is temporarily unavailable. Try again.",
    insufficient_stock: "Sales history is temporarily unavailable. Try again.",
    invalid_cursor: "This sales list changed. Refresh the latest results.",
    price_changed: "Sales history is temporarily unavailable. Try again.",
    product_inactive: "Sales history is temporarily unavailable. Try again.",
    product_not_found: "Sales history is temporarily unavailable. Try again.",
    sale_not_found: "This sale is no longer available at this branch.",
    sale_already_fully_refunded: "This sale is already fully refunded.",
    refund_quantity_exceeded:
      "A refund quantity exceeds what remains on the original sale.",
    stale_vat_profile: "Sales history is temporarily unavailable. Try again.",
    unavailable: "Sales history is temporarily unavailable. Try again.",
    validation: "Check the cashier user ID and try again.",
    vat_configuration_required:
      "Sales history is temporarily unavailable. Try again.",
  };
  return messages[error.kind];
}

export function SalesHistoryManagement() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedOrganizationId = searchParams.get("organizationId");
  const requestedBranchId = searchParams.get("branchId");
  const contextQuery = useQuery({
    queryFn: fetchAccessContext,
    queryKey: ["access-context"],
  });
  const resolved = contextQuery.data
    ? resolveApplicationContext(
        contextQuery.data,
        requestedOrganizationId,
        requestedBranchId,
      )
    : null;

  useEffect(() => {
    if (resolved?.organization === null || resolved?.organization === undefined)
      return;
    const canonical = salesUrl(
      resolved.organization.id,
      resolved.branch?.id ?? null,
    );
    const current = salesUrl(requestedOrganizationId ?? "", requestedBranchId);
    if (canonical !== current) router.replace(canonical);
  }, [requestedBranchId, requestedOrganizationId, resolved, router]);

  if (contextQuery.isPending) return <p aria-live="polite">Loading access…</p>;
  if (contextQuery.isError)
    return (
      <p className="form-message" role="alert">
        Your access context could not be loaded.
      </p>
    );
  if (resolved?.organization === null) {
    return (
      <ContextUnavailable message="Choose an active organization from the workspace before viewing sales." />
    );
  }
  if (resolved === null) return null;
  if (resolved.branch === null) {
    return (
      <ContextUnavailable
        message="Choose an active branch before viewing sales."
        title="Branch context required"
      />
    );
  }
  if (!HISTORY_ROLES.has(resolved.organization.role)) {
    return (
      <ContextUnavailable
        message="Your current role cannot view sales history."
        title="Sales history unavailable"
      />
    );
  }
  return (
    <SalesHistoryContent
      branch={resolved.branch}
      organization={resolved.organization}
    />
  );
}

function ContextUnavailable({
  message,
  title = "Sales history unavailable",
}: {
  message: string;
  title?: string;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{message}</p>
      <Link className="underline" href="/app">
        Return to workspace
      </Link>
    </section>
  );
}

function SalesHistoryContent({
  branch,
  organization,
}: {
  branch: AccessibleOrganization["branches"][number];
  organization: AccessibleOrganization;
}) {
  const { t } = useLanguage();

  const context = {
    branchId: branch.id,
    organizationId: organization.id,
  } satisfies SalesRequestContext;
  const scopeKey = salesScopeKey(context);
  const [actorInput, setActorInput] = useState("");
  const [actorUserId, setActorUserId] = useState<string | undefined>();
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const historyQuery = useInfiniteQuery<
    SalesHistoryPage,
    Error,
    InfiniteData<SalesHistoryPage>,
    readonly unknown[],
    string | null
  >({
    getNextPageParam: (page) => page.meta.nextCursor,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      listSalesHistory(context, {
        ...(actorUserId === undefined ? {} : { actorUserId }),
        cursor: pageParam,
      }),
    queryKey: [...scopeKey, "history", { actorUserId: actorUserId ?? null }],
  });
  const sales =
    historyQuery.data?.pages.flatMap((page) => page.data.sales) ?? [];

  useEffect(() => {
    setSelectedSaleId(null);
  }, [branch.id, organization.id, actorUserId]);

  return (
    <section className="w-full space-y-8">
      <header className="space-y-2">
        <Link
          className="text-sm underline"
          href={applicationContextUrl(organization.id, branch.id)}
        >
          {t("backToWorkspace")}
        </Link>
        <h1 className="text-2xl font-semibold">Sales history</h1>
        <p className="text-muted-foreground">
          Completed sales at {branch.code} — {branch.name}. Sale timestamps are
          shown in UTC. Analytics uses the organization's reporting timezone for
          calendar periods.
        </p>
      </header>

      <form
        aria-label="Filter sales history"
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = actorInput.trim();
          if (value !== "" && !UUID_PATTERN.test(value)) {
            setFilterError("Enter a valid cashier user ID or leave it blank.");
            return;
          }
          setFilterError(null);
          setActorUserId(value === "" ? undefined : value);
        }}
      >
        <Label className="form-field w-full sm:w-96">
          Cashier user ID (optional)
          <Input
            aria-describedby={filterError ? "sales-filter-error" : undefined}
            className=""
            onChange={(event) => setActorInput(event.target.value)}
            placeholder="Exact UUID only"
            value={actorInput}
          />
        </Label>
        <Button variant="outline" type="submit">
          Apply filter
        </Button>
        <Button
          variant="outline"
          disabled={actorInput === "" && actorUserId === undefined}
          onClick={() => {
            setActorInput("");
            setActorUserId(undefined);
            setFilterError(null);
          }}
          type="button"
        >
          Clear filter
        </Button>
        {filterError ? (
          <p className="form-message" id="sales-filter-error" role="alert">
            {filterError}
          </p>
        ) : null}
      </form>

      <SalesList
        error={historyQuery.error}
        hasNextPage={historyQuery.hasNextPage}
        isLoading={historyQuery.isPending}
        isLoadingNext={historyQuery.isFetchingNextPage}
        onLoadMore={() => void historyQuery.fetchNextPage()}
        onSelect={setSelectedSaleId}
        sales={sales}
        selectedSaleId={selectedSaleId}
      />
      {selectedSaleId !== null ? (
        <SalesDetail
          canCreateRefund={REFUND_CREATE_ROLES.has(organization.role)}
          context={context}
          key={selectedSaleId}
          saleId={selectedSaleId}
          scopeKey={scopeKey}
        />
      ) : null}
    </section>
  );
}

function SalesList({
  error,
  hasNextPage,
  isLoading,
  isLoadingNext,
  onLoadMore,
  onSelect,
  sales,
  selectedSaleId,
}: {
  error: Error | null;
  hasNextPage: boolean;
  isLoading: boolean;
  isLoadingNext: boolean;
  onLoadMore: () => void;
  onSelect: (saleId: string) => void;
  sales: SalesHistorySummary[];
  selectedSaleId: string | null;
}) {
  if (isLoading) return <p aria-live="polite">Loading sales history…</p>;
  if (error !== null)
    return (
      <p className="form-message" role="alert">
        {errorMessage(error)}
      </p>
    );
  if (sales.length === 0) {
    return (
      <p className="rounded-lg border p-5 text-muted-foreground">
        No completed sales match this branch and filter.
      </p>
    );
  }
  return (
    <section aria-label="Sales history" className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table className="w-full min-w-[45rem] text-left text-sm">
          <TableHeader className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <TableRow>
              <TableHead className="px-4 py-3 font-medium">Sale</TableHead>
              <TableHead className="px-4 py-3 font-medium">Cashier</TableHead>
              <TableHead className="px-4 py-3 font-medium">Payment</TableHead>
              <TableHead className="px-4 py-3 text-right font-medium">
                Total
              </TableHead>
              <TableHead className="relative px-4 py-3 font-medium">
                <span className="sr-only">Open detail</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((sale) => (
              <TableRow className="border-b last:border-0" key={sale.id}>
                <TableCell className="px-4 py-3">
                  <p className="font-medium">{sale.reference}</p>
                  <p className="text-muted-foreground">
                    {formatAbsoluteTimestamp(sale.createdAt)} · {sale.itemCount}{" "}
                    item{sale.itemCount === 1 ? "" : "s"}
                  </p>
                  <p className="text-muted-foreground">
                    {sale.refundState.replaceAll("_", " ")} · Remaining{" "}
                    {formatThb(sale.remainingAmount)}
                  </p>
                </TableCell>
                <TableCell className="px-4 py-3">
                  {sale.actorDisplayName}
                </TableCell>
                <TableCell className="px-4 py-3">
                  {sale.payment.method}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium">
                  {formatThb(sale.totalAmount)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    aria-pressed={selectedSaleId === sale.id}
                    onClick={() => onSelect(sale.id)}
                    type="button"
                  >
                    View detail
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasNextPage ? (
        <Button
          variant="outline"
          disabled={isLoadingNext}
          onClick={onLoadMore}
          type="button"
        >
          {isLoadingNext ? "Loading more…" : "Load more sales"}
        </Button>
      ) : null}
    </section>
  );
}

function SalesDetail({
  canCreateRefund,
  context,
  saleId,
  scopeKey,
}: {
  canCreateRefund: boolean;
  context: SalesRequestContext;
  saleId: string;
  scopeKey: readonly unknown[];
}) {
  const detailRef = useRef<HTMLElement>(null);
  const hasScrolled = useRef(false);
  const detailQuery = useQuery({
    queryFn: () => getSalesHistoryDetail(context, saleId),
    queryKey: [...scopeKey, "detail", saleId],
  });

  useEffect(() => {
    if (!detailQuery.isSuccess || hasScrolled.current || !detailRef.current)
      return;
    hasScrolled.current = true;
    detailRef.current.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }, [detailQuery.isSuccess]);

  return (
    <section
      aria-live="polite"
      className="scroll-mt-6 space-y-6 rounded-lg border bg-card p-5 sm:p-7"
      ref={detailRef}
    >
      {detailQuery.isPending ? <p>Loading sale detail…</p> : null}
      {detailQuery.isError ? (
        <p className="form-message" role="alert">
          {errorMessage(detailQuery.error)}
        </p>
      ) : null}
      {detailQuery.data ? (
        <SaleDetailContent
          canCreateRefund={canCreateRefund}
          context={context}
          sale={detailQuery.data}
          scopeKey={scopeKey}
        />
      ) : null}
    </section>
  );
}

function SaleDetailContent({
  canCreateRefund,
  context,
  sale,
  scopeKey,
}: {
  canCreateRefund: boolean;
  context: SalesRequestContext;
  sale: SalesHistoryDetail;
  scopeKey: readonly unknown[];
}) {
  const includesCosts = sale.items.some(
    (item) => item.cogsAmount !== undefined || item.unitCost !== undefined,
  );
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{sale.reference}</h2>
          <p className="text-sm text-muted-foreground">
            {formatAbsoluteTimestamp(sale.createdAt)} · {sale.actorDisplayName}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()} type="button">
          Print receipt
        </Button>
      </div>
      <SaleItems sale={sale} />
      <SaleTotals sale={sale} />
      <PaymentDetails payment={sale.payment} />
      {includesCosts ? <CostDetails sale={sale} /> : null}
      <RefundHistory sale={sale} />
      {canCreateRefund && sale.refundState !== "FULLY_REFUNDED" ? (
        <RefundPanel
          context={context}
          key={sale.id}
          sale={sale}
          scopeKey={scopeKey}
        />
      ) : null}
      <SaleReceipt sale={sale} />
    </>
  );
}

function RefundHistory({ sale }: { sale: SalesHistoryDetail }) {
  return (
    <section aria-labelledby="refund-history-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold" id="refund-history-heading">
          Refunds
        </h3>
        <p className="text-sm text-muted-foreground">
          {sale.refundState.replaceAll("_", " ")} · Refunded{" "}
          {formatThb(sale.refundedAmount)} · Remaining{" "}
          {formatThb(sale.remainingAmount)}
        </p>
      </div>
      {sale.refunds.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No refunds are linked to this sale.
        </p>
      ) : (
        <div className="space-y-3">
          {sale.refunds.map((refund) => (
            <article className="rounded-md border p-4 text-sm" key={refund.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{refund.reference}</p>
                  <p className="text-muted-foreground">
                    {formatAbsoluteTimestamp(refund.completedAt)} ·{" "}
                    {refund.actorDisplayName}
                  </p>
                </div>
                <p className="font-medium">{formatThb(refund.totalAmount)}</p>
              </div>
              <p className="mt-2">Reason: {refund.reason}</p>
              <p className="text-muted-foreground">
                {refund.payment.method}
                {refund.payment.reference === null
                  ? ""
                  : ` · ${refund.payment.reference}`}
              </p>
              <ul className="mt-3 space-y-1 border-t pt-3">
                {refund.items.map((item) => {
                  const original = sale.items.find(
                    (saleItem) => saleItem.id === item.saleItemId,
                  );
                  return (
                    <li key={item.id}>
                      {original?.productName ?? item.productId}: refunded{" "}
                      {item.refundQuantity}, restocked {item.restockQuantity} ·{" "}
                      {formatThb(item.reversedLineNet)}
                      {item.cogsReversalAmount === undefined
                        ? ""
                        : item.cogsReversalAmount === null
                          ? " · COGS unavailable"
                          : ` · COGS ${formatThb(item.cogsReversalAmount)}`}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RefundPanel({
  context,
  sale,
  scopeKey,
}: {
  context: SalesRequestContext;
  sale: SalesHistoryDetail;
  scopeKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      sale.items.map((item) => [
        item.id,
        { quantity: "", restockQuantity: "0" },
      ]),
    ),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const lastAttempt = useRef<{ key: string; signature: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (request: {
      idempotencyKey: string;
      input: Parameters<typeof createSaleRefund>[3];
    }) =>
      createSaleRefund(context, sale.id, request.idempotencyKey, request.input),
    onSuccess: async () => {
      setReason("");
      setTransferReference("");
      setLines(
        Object.fromEntries(
          sale.items.map((item) => [
            item.id,
            { quantity: "", restockQuantity: "0" },
          ]),
        ),
      );
      lastAttempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...scopeKey, "detail", sale.id],
        }),
        queryClient.invalidateQueries({ queryKey: [...scopeKey, "history"] }),
      ]);
    },
  });
  const refundableItems = sale.items.filter(
    (item) => item.remainingRefundableQuantity !== "0.0000",
  );

  return (
    <form
      aria-label="Create sale refund"
      className="space-y-4 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const items = refundableItems.flatMap((item) => {
          const line = lines[item.id];
          const quantity = line?.quantity.trim() ?? "";
          return quantity === ""
            ? []
            : [
                {
                  quantity,
                  restockQuantity: line?.restockQuantity.trim() || "0",
                  saleItemId: item.id,
                },
              ];
        });
        if (items.length === 0) {
          setValidationError("Enter a refund quantity for at least one item.");
          return;
        }
        if (reason.trim() === "") {
          setValidationError("Enter a reason for this refund.");
          return;
        }
        if (
          sale.payment.method === "TRANSFER" &&
          transferReference.trim() === ""
        ) {
          setValidationError("Enter the confirmed transfer reference.");
          return;
        }
        const input = {
          items,
          reason,
          transferReference:
            sale.payment.method === "TRANSFER" ? transferReference : null,
        };
        const signature = JSON.stringify(input);
        const idempotencyKey =
          lastAttempt.current?.signature === signature
            ? lastAttempt.current.key
            : crypto.randomUUID();
        lastAttempt.current = { key: idempotencyKey, signature };
        setValidationError(null);
        mutation.mutate({ idempotencyKey, input });
      }}
    >
      <div>
        <h3 className="font-semibold">Create refund</h3>
        <p className="text-sm text-muted-foreground">
          Refund money and returned stock are recorded separately. This action
          cannot be edited or deleted.
        </p>
      </div>
      <div className="space-y-3">
        {refundableItems.map((item) => (
          <fieldset
            className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
            key={item.id}
          >
            <legend className="px-1 text-sm font-medium">
              {item.productName} · {item.remainingRefundableQuantity}{" "}
              {item.unit} remaining
            </legend>
            <Label className="form-field">
              Refund quantity
              <Input
                className="form-control--numeric"
                inputMode="decimal"
                onChange={(event) =>
                  setLines((current) => ({
                    ...current,
                    [item.id]: {
                      ...current[item.id]!,
                      quantity: event.target.value,
                    },
                  }))
                }
                placeholder="0"
                value={lines[item.id]?.quantity ?? ""}
              />
            </Label>
            <Label className="form-field">
              Restock quantity
              <Input
                className="form-control--numeric"
                inputMode="decimal"
                onChange={(event) =>
                  setLines((current) => ({
                    ...current,
                    [item.id]: {
                      ...current[item.id]!,
                      restockQuantity: event.target.value,
                    },
                  }))
                }
                value={lines[item.id]?.restockQuantity ?? "0"}
              />
            </Label>
          </fieldset>
        ))}
      </div>
      <Label className="form-field">
        Reason
        <Textarea
          className=""
          maxLength={200}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </Label>
      {sale.payment.method === "TRANSFER" ? (
        <Label className="form-field">
          Confirmed transfer reference
          <Input
            className=""
            maxLength={100}
            onChange={(event) => setTransferReference(event.target.value)}
            required
            value={transferReference}
          />
        </Label>
      ) : null}
      {validationError !== null ? (
        <p className="form-message" role="alert">
          {validationError}
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="form-message" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {mutation.data ? (
        <p role="status">Refund {mutation.data.reference} completed.</p>
      ) : null}
      <Button variant="outline" disabled={mutation.isPending} type="submit">
        {mutation.isPending
          ? "Recording refund…"
          : "Confirm irreversible refund"}
      </Button>
    </form>
  );
}

function SaleItems({ sale }: { sale: SalesHistoryDetail }) {
  return (
    <section aria-labelledby="sale-items-heading" className="space-y-3">
      <h3 className="font-semibold" id="sale-items-heading">
        Items
      </h3>
      <div
        aria-label="Sale item details"
        className="overflow-x-auto rounded-md border focus-visible:outline-2 focus-visible:outline-ring"
        role="region"
        tabIndex={0}
      >
        <Table className="w-full min-w-[40rem] text-left text-sm">
          <TableHeader className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <TableRow>
              <TableHead className="px-3 py-2">Product</TableHead>
              <TableHead className="px-3 py-2">Quantity</TableHead>
              <TableHead className="px-3 py-2 text-right">Unit price</TableHead>
              <TableHead className="px-3 py-2 text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.items.map((item) => (
              <TableRow className="border-b last:border-0" key={item.id}>
                <TableCell className="px-3 py-2">
                  <p className="font-medium">{item.productName}</p>
                  <p className="text-muted-foreground">
                    {item.productSku} · {item.unit}
                  </p>
                </TableCell>
                <TableCell className="px-3 py-2">{item.quantity}</TableCell>
                <TableCell className="px-3 py-2 text-right">
                  {formatThb(item.unitPrice)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right">
                  {formatThb(item.lineNet)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SaleTotals({ sale }: { sale: SalesHistoryDetail }) {
  return (
    <section
      aria-label="Sale totals"
      className="ml-auto max-w-sm space-y-2 text-sm"
    >
      <TotalRow label="Subtotal" value={sale.subtotalAmount} />
      {sale.discountAmount !== "0.00" ? (
        <TotalRow label="Discount" value={sale.discountAmount} />
      ) : null}
      {sale.taxableAmount !== null ? (
        <TotalRow label="Taxable amount" value={sale.taxableAmount} />
      ) : null}
      <TotalRow label="VAT" value={sale.outputVatAmount} />
      <TotalRow emphasis label="Total" value={sale.totalAmount} />
    </section>
  );
}

function TotalRow({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div
      className={
        emphasis
          ? "flex justify-between border-t pt-2 text-base font-semibold"
          : "flex justify-between"
      }
    >
      <span>{label}</span>
      <span>{formatThb(value)}</span>
    </div>
  );
}

function PaymentDetails({
  payment,
}: {
  payment: SalesHistoryDetail["payment"];
}) {
  return (
    <section
      aria-labelledby="payment-heading"
      className="rounded-md border p-4 text-sm"
    >
      <h3 className="font-semibold" id="payment-heading">
        Payment
      </h3>
      <p className="mt-2">
        {payment.method} · {formatThb(payment.amount)}
      </p>
      {payment.method === "CASH" ? (
        <p className="text-muted-foreground">
          Tendered {formatThb(payment.amountTendered)} · Change{" "}
          {formatThb(payment.changeAmount)}
        </p>
      ) : null}
      {payment.method === "TRANSFER" && payment.reference !== null ? (
        <p className="text-muted-foreground">Reference {payment.reference}</p>
      ) : null}
    </section>
  );
}

function CostDetails({ sale }: { sale: SalesHistoryDetail }) {
  return (
    <section
      aria-labelledby="cost-details-heading"
      className="rounded-md border p-4 text-sm"
    >
      <h3 className="font-semibold" id="cost-details-heading">
        Internal cost details
      </h3>
      <ul className="mt-2 space-y-1">
        {sale.items.map((item) =>
          item.cogsAmount !== undefined ? (
            <li key={item.id}>
              {item.productName}: COGS{" "}
              {item.cogsAmount === null
                ? "Unavailable"
                : formatThb(item.cogsAmount)}
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}
