"use client";

import { useEffect, useRef, useState } from "react";

import {
  searchPosProducts,
  SalesApiError,
  type PosProduct,
  type SalesRequestContext,
} from "@/sales-api-client";

import { PosCameraScanner } from "./pos-camera-scanner";

function lookupError(error: unknown, barcode: string): string {
  if (error instanceof SalesApiError) {
    if (error.kind === "authentication_required")
      return "Sign in again to scan products.";
    if (error.kind === "forbidden" || error.kind === "branch_inactive")
      return "Scanning is unavailable for this branch or your current access.";
    if (error.kind === "validation")
      return `Invalid barcode: ${barcode}. Check the value and scan again.`;
  }
  return `Could not look up barcode ${barcode}. Your cart was kept. Scan again to retry.`;
}

export function PosBarcodeScanner({
  context,
  disabled,
  onAdd,
  onPendingChange,
}: {
  context: SalesRequestContext;
  disabled: boolean;
  onAdd: (product: PosProduct) => void;
  onPendingChange: (count: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraOpenRef = useRef(false);
  const [pending, setPending] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const queue = useRef<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onAdd, onPendingChange, disabled });
  callbacks.current = { onAdd, onPendingChange, disabled };

  useEffect(() => {
    return () => {
      generation.current += 1;
      queue.current = [];
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    // Focus only after the native modal is removed and the input is no longer inert.
    if (!cameraOpen && !disabled) input.current?.focus();
  }, [cameraOpen, disabled]);

  function reportPending() {
    setPending(queue.current.length);
    callbacks.current.onPendingChange(
      queue.current.length + (cameraOpenRef.current ? 1 : 0),
    );
  }

  function showResult(message: string) {
    setResults((current) => [...current.slice(-4), message]);
  }

  async function drain() {
    const currentGeneration = generation.current;
    while (queue.current.length > 0) {
      const barcode = queue.current[0]!;
      const requestController = new AbortController();
      controller.current = requestController;
      // Bound a stalled request so later scans can proceed; never retry an add automatically.
      const timeout = window.setTimeout(
        () => requestController.abort(),
        15_000,
      );
      let message: string;
      try {
        const response = await searchPosProducts(context, {
          barcode,
          signal: requestController.signal,
        });
        if (currentGeneration !== generation.current) return;
        const product = response.data.products[0];
        if (response.data.products.length === 0) {
          message = `No product found for barcode ${barcode}.`;
        } else if (response.data.products.length !== 1) {
          message = `Could not look up barcode ${barcode}. Scan again to retry.`;
        } else if (!product?.available) {
          message = `Product for barcode ${barcode} is unavailable in this branch.`;
        } else if (callbacks.current.disabled) {
          message = `Barcode ${barcode} was not added during checkout. Scan again afterward.`;
        } else {
          callbacks.current.onAdd(product);
          message = `Added ${product.name} — barcode ${barcode}.`;
        }
      } catch (error) {
        if (currentGeneration !== generation.current) return;
        message = lookupError(error, barcode);
      } finally {
        window.clearTimeout(timeout);
      }
      showResult(message);
      queue.current.shift();
      reportPending();
    }
    controller.current = null;
  }

  function submit(value: string) {
    const barcode = value.trim();
    if (barcode === "") return; // Ignore extra Enter/CR/LF terminators after the field is cleared.
    if (callbacks.current.disabled) {
      showResult("Wait for checkout to finish, then scan again.");
      return;
    }
    if (input.current) input.current.value = "";
    const wasEmpty = queue.current.length === 0;
    queue.current.push(barcode);
    reportPending();
    if (wasEmpty) void drain();
  }

  function closeCamera() {
    cameraOpenRef.current = false;
    setCameraOpen(false);
    reportPending();
  }

  return (
    <section
      aria-label="Barcode scanning"
      className="min-w-0 space-y-3 rounded-lg border p-4"
    >
      <form
        aria-label="Scan POS barcode"
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input.current?.value ?? "");
          input.current?.focus();
        }}
      >
        <label className="form-field">
          Scan or enter barcode
          <input
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            className="form-control"
            disabled={disabled}
            name="barcode"
            ref={input}
          />
        </label>
        <button
          className="form-action self-end rounded-md border disabled:opacity-60"
          disabled={disabled}
          type="submit"
        >
          Add barcode
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        USB/Bluetooth keyboard scanner: keep this field focused and use Enter.
        Other fields keep normal keyboard behavior.
      </p>
      <button
        className="form-action rounded-md border disabled:opacity-60"
        disabled={disabled}
        type="button"
        onClick={() => {
          cameraOpenRef.current = true;
          setCameraOpen(true);
          reportPending();
        }}
      >
        Scan with camera
      </button>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="space-y-1 text-sm break-words"
      >
        <p>
          {pending > 0
            ? `Looking up barcodes… ${pending} pending. Checkout waits for these scans.`
            : "Ready to scan."}
        </p>
        {results.length > 0 ? (
          <ul aria-label="Recent scans">
            {results.map((message, index) => (
              <li key={`${index}:${message}`}>{message}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {cameraOpen ? (
        <PosCameraScanner
          onClose={closeCamera}
          onDetected={(barcode) => {
            submit(barcode);
            closeCamera();
          }}
        />
      ) : null}
    </section>
  );
}
