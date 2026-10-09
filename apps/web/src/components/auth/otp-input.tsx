"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

import { useLanguage } from "@/providers/language-provider";

interface OtpInputProps {
  disabled?: boolean;
  id: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  value: string;
}

export function OtpInput({
  disabled = false,
  id,
  invalid = false,
  describedBy,
  onChange,
  value,
}: OtpInputProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (selection === null) return;
    inputRef.current?.setSelectionRange(selection.start, selection.end);
    setSelection(null);
  }, [selection, value]);
  function normalize(input: HTMLInputElement) {
    const raw = input.value;
    const start = input.selectionStart ?? raw.length;
    const end = input.selectionEnd ?? start;
    const nextValue = raw.replace(/[^0-9]/g, "").slice(0, 6);
    setSelection({
      start: Math.min(
        raw.slice(0, start).replace(/[^0-9]/g, "").length,
        nextValue.length,
      ),
      end: Math.min(
        raw.slice(0, end).replace(/[^0-9]/g, "").length,
        nextValue.length,
      ),
    });
    onChange(nextValue);
  }

  return (
    <Input
      aria-describedby={describedBy}
      aria-invalid={invalid}
      aria-label={t("authOtpLabel")}
      autoComplete="one-time-code"
      className="h-12 text-center text-2xl tracking-widest"
      disabled={disabled}
      id={id}
      inputMode="numeric"
      maxLength={6}
      onPaste={(event) => {
        event.preventDefault();
        const pasted = event.clipboardData
          .getData("text")
          .replace(/[^0-9]/g, "");
        if (pasted.length === 0) return;

        const input = event.currentTarget;
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? start;
        const raw = `${value.slice(0, start)}${pasted}${value.slice(end)}`;
        const nextValue = raw.replace(/[^0-9]/g, "").slice(0, 6);
        const caret = Math.min(start + pasted.length, nextValue.length);
        setSelection({ start: caret, end: caret });
        onChange(nextValue);
      }}
      onChange={(event) => normalize(event.currentTarget)}
      pattern="[0-9]{6}"
      ref={inputRef}
      required
      type="text"
      value={value}
    />
  );
}
