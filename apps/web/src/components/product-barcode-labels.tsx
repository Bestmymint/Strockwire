"use client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import JsBarcode from "jsbarcode";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CatalogProduct } from "@/catalog-api-client";

// One generic sheet-label preset; widen long symbols rather than compress bars.
const MODULE_WIDTH_MM = 0.33;
const QUIET_ZONE_MODULES = 10;
const MIN_LABEL_WIDTH_MM = 100;
const MAX_LABEL_WIDTH_MM = 190;
const LABEL_PADDING_MM = 4;
const MAX_QUANTITY = 100;

export function encodeProductLabel(barcode: string | null) {
  if (barcode === null || barcode === "") {
    return { error: "Set and save a barcode before printing labels." };
  }
  // ADR-022 permits Unicode identifiers. Code 128 labels support printable ASCII;
  // preserve other stored identifiers instead of substituting or normalizing them.
  if (barcode.length > 128 || !/^[\x20-\x7e]+$/.test(barcode)) {
    return {
      error:
        "Code 128 labels support printable ASCII characters only. The saved barcode is unchanged.",
    };
  }
  const target: { encodings?: { data: string }[] } = {};
  try {
    JsBarcode(target, barcode, { format: "CODE128", displayValue: false });
  } catch {
    return { error: "This barcode cannot be rendered as a Code 128 label." };
  }
  const data = target.encodings?.map((encoding) => encoding.data).join("");
  if (!data) return { error: "This barcode could not be rendered." };
  const modules = data.length + 2 * QUIET_ZONE_MODULES;
  const symbolWidthMm = modules * MODULE_WIDTH_MM;
  const labelWidthMm = Math.max(
    MIN_LABEL_WIDTH_MM,
    symbolWidthMm + 2 * LABEL_PADDING_MM,
  );
  if (labelWidthMm > MAX_LABEL_WIDTH_MM) {
    return {
      error:
        "This barcode is too wide for the A4 label preset at a scannable bar size. Use a shorter internal identifier or a larger label format. The saved barcode is unchanged.",
    };
  }
  return { data, labelWidthMm, modules, symbolWidthMm };
}

export function ProductBarcodeLabels({
  product,
}: {
  product: Pick<CatalogProduct, "name" | "sku" | "barcode">;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="mt-4">
      <Button
        variant="outline"
        className=""
        disabled={product.barcode === null}
        onClick={() => setOpen(true)}
        ref={trigger}
        type="button"
      >
        Preview barcode labels
      </Button>
      {product.barcode === null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No barcode set. Save a barcode to print labels.
        </p>
      ) : null}
      {open ? (
        <LabelPreview
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
          product={product}
        />
      ) : null}
    </div>
  );
}

function LabelPreview({
  onClose,
  product,
}: {
  onClose: () => void;
  product: Pick<CatalogProduct, "name" | "sku" | "barcode">;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const quantityId = useId();
  const quantityErrorId = useId();
  const [quantity, setQuantity] = useState("1");
  const encoding = encodeProductLabel(product.barcode);
  const count = /^[1-9]\d{0,2}$/.test(quantity) ? Number(quantity) : 0;
  const validQuantity = count >= 1 && count <= MAX_QUANTITY;
  const closePreview = () => {
    dialog.current?.close();
    onClose();
  };

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return createPortal(
    <div className="barcode-label-workflow">
      <dialog
        aria-labelledby={titleId}
        className="barcode-label-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closePreview();
        }}
        ref={dialog}
      >
        <div className="barcode-label-controls space-y-4">
          <h2 className="text-xl font-semibold" id={titleId}>
            Barcode label preview
          </h2>
          <p className="text-sm text-muted-foreground">
            Labels use saved product details. Save edits before printing. Code
            128, black on white; no price included. Print on A4 at 100% scale,
            with browser headers and footers disabled.
          </p>
          <Label className="form-field" htmlFor={quantityId}>
            Label quantity
            <Input
              aria-describedby={validQuantity ? undefined : quantityErrorId}
              aria-invalid={!validQuantity}
              className="form-control--numeric"
              id={quantityId}
              max={MAX_QUANTITY}
              min={1}
              onChange={(event) => setQuantity(event.target.value)}
              step={1}
              type="number"
              value={quantity}
            />
          </Label>
          {!validQuantity ? (
            <p className="form-message" id={quantityErrorId} role="alert">
              Enter a whole number from 1 to {MAX_QUANTITY}.
            </p>
          ) : null}
          {encoding.error ? (
            <p className="form-message" role="alert">
              {encoding.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              className=""
              disabled={!validQuantity || encoding.data === undefined}
              onClick={() => window.print()}
              type="button"
            >
              Print labels
            </Button>
            <Button
              variant="outline"
              className=""
              onClick={closePreview}
              type="button"
            >
              Back to catalog
            </Button>
          </div>
          {encoding.labelWidthMm ? (
            <p className="text-sm text-muted-foreground">
              Label: {encoding.labelWidthMm.toFixed(1)} mm wide, at least 50 mm
              high. Long values widen the label up to 190 mm.
            </p>
          ) : null}
        </div>
        <div
          aria-label="Printable barcode labels"
          className="barcode-label-sheet"
        >
          {encoding.data !== undefined && validQuantity
            ? Array.from({ length: count }, (_, index) => (
                <article
                  className="product-barcode-label"
                  key={index}
                  style={{ width: `${encoding.labelWidthMm}mm` }}
                >
                  <p className="barcode-label-name">{product.name}</p>
                  <svg
                    aria-label={`Code 128 barcode ${product.barcode}`}
                    className="product-barcode-symbol"
                    height="20mm"
                    role="img"
                    viewBox={`0 0 ${encoding.modules} 60`}
                    width={`${encoding.symbolWidthMm}mm`}
                  >
                    <rect fill="white" height="60" width={encoding.modules} />
                    {Array.from(encoding.data.matchAll(/1+/g), (run) => (
                      <rect
                        fill="black"
                        height="60"
                        key={run.index}
                        width={run[0].length}
                        x={run.index + QUIET_ZONE_MODULES}
                        y="0"
                      />
                    ))}
                  </svg>
                  <p className="barcode-label-value">{product.barcode}</p>
                  {product.sku !== product.barcode ? (
                    <p className="barcode-label-sku">SKU: {product.sku}</p>
                  ) : null}
                </article>
              ))
            : null}
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
