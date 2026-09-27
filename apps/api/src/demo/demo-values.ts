import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";

const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
const prefix = "stockwise-demo-v1|20260926";

export function demoId(kind: string, naturalKey: string): string {
  const bytes = createHash("sha1")
    .update(namespace)
    .update(`${prefix}|${kind}|${naturalKey}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function demoDemand(
  date: string,
  branch: "DEMO-A" | "DEMO-B",
  sku: string,
): string {
  const day = Temporal.PlainDate.from(date);
  const index = Temporal.PlainDate.from("2025-01-01").until(day, {
    largestUnit: "day",
  }).days;
  if (sku === "DEMO-STABLE") return branch === "DEMO-A" ? "2" : "1";
  if (branch === "DEMO-B") return "0";
  if (sku === "DEMO-WEIGHT") return "0.5000";
  if (sku === "DEMO-SPARSE") return index % 7 === 0 ? "1" : "0";
  if (sku === "DEMO-NEW") return date >= "2026-09-12" ? "1" : "0";
  if (sku !== "DEMO-WEEKLY") return "0";
  const baseline = (day.dayOfWeek >= 6 ? 3 : 1) + (day.month === 12 ? 2 : 0);
  const digest = createHash("sha256")
    .update(`${prefix}|DEMO-A|DEMO-WEEKLY|${date}`, "utf8")
    .digest();
  return String(Math.max(0, baseline + (digest.readUInt32BE(0) % 3) - 1));
}
