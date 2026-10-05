import { formatThb } from "@/money-display";
import type { CompletedSale, SalesHistoryDetail } from "@/sales-api-client";

export function SaleReceipt({
  sale,
}: {
  sale: CompletedSale | SalesHistoryDetail;
}) {
  // Both API projections contain frozen Sale facts; adapt names, never economics.
  const receipt =
    "occurredAt" in sale
      ? {
          actorDisplayName: sale.actorDisplayNameSnapshot,
          branchCode: sale.branchCodeSnapshot,
          branchName: sale.branchNameSnapshot,
          timestamp: sale.occurredAt,
          organizationName: sale.organizationNameSnapshot,
          items: sale.items.map((item) => ({
            ...item,
            productName: item.nameSnapshot,
            productSku: item.skuSnapshot,
            unit: item.unitSnapshot,
          })),
        }
      : { ...sale, timestamp: sale.createdAt };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Receipt preview · 80 mm paper. Select your printer's 80 mm paper size,
        use 100% scale, and turn off browser headers and footers.
      </p>
      <article aria-label="Printable receipt" className="sales-receipt">
        <header className="sales-receipt-header">
          <h2>{receipt.organizationName}</h2>
          <p>
            {receipt.branchCode} — {receipt.branchName}
          </p>
          <p>Operational sale receipt</p>
        </header>
        <div className="sales-receipt-identity">
          <p>Sale {sale.reference}</p>
          <p>
            {receipt.timestamp.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}
          </p>
          <p>Cashier: {receipt.actorDisplayName}</p>
        </div>
        <ul className="sales-receipt-items">
          {receipt.items.map((item) => (
            <li key={item.id}>
              <p className="sales-receipt-item-name">{item.productName}</p>
              <div className="sales-receipt-row">
                <span>
                  {item.quantity} {item.unit} × {formatThb(item.unitPrice)}
                </span>
                <strong>{formatThb(item.lineNet)}</strong>
              </div>
              <p className="sales-receipt-sku">{item.productSku}</p>
            </li>
          ))}
        </ul>
        <div className="sales-receipt-summary">
          <dl>
            <ReceiptAmount label="Subtotal" value={sale.subtotalAmount} />
            {sale.discountAmount !== "0.00" ? (
              <ReceiptAmount label="Discount" value={sale.discountAmount} />
            ) : null}
            {sale.taxableAmount !== null ? (
              <ReceiptAmount
                label="Taxable amount"
                value={sale.taxableAmount}
              />
            ) : null}
            <ReceiptAmount label="VAT" value={sale.outputVatAmount} />
            <ReceiptAmount label="Total" value={sale.totalAmount} emphasis />
          </dl>
          <footer>
            <p>
              Payment: {sale.payment.method} · {formatThb(sale.payment.amount)}
            </p>
            {sale.payment.method === "CASH" ? (
              <p>
                Tendered {formatThb(sale.payment.amountTendered)} · Change{" "}
                {formatThb(sale.payment.changeAmount)}
              </p>
            ) : null}
            {sale.payment.method === "TRANSFER" &&
            sale.payment.reference !== null ? (
              <p>Transfer reference: {sale.payment.reference}</p>
            ) : null}
            <p className="sales-receipt-thanks">Thank you</p>
          </footer>
        </div>
      </article>
    </>
  );
}

function ReceiptAmount({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`sales-receipt-row${emphasis ? " sales-receipt-total" : ""}`}
    >
      <dt>{label}</dt>
      <dd>{formatThb(value)}</dd>
    </div>
  );
}
