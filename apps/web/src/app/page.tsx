import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardList,
  Package,
  Receipt,
  ShoppingCart,
  Store,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "StockWise | Inventory and sales, in one workspace",
  description:
    "Catalog, branch inventory, purchasing, receiving, POS, sales history and analytics for SME retail operations.",
};
const features = [
  [
    Package,
    "Catalog",
    "Keep products, categories, SKUs and barcodes organized across your business.",
  ],
  [
    Boxes,
    "Branch inventory",
    "See stock balances and trace adjustments through movement history.",
  ],
  [
    Truck,
    "Suppliers",
    "Keep supplier contacts alongside your purchasing workflow.",
  ],
  [
    ClipboardList,
    "Purchase orders & receiving",
    "Follow orders through arrival and record received quantities and costs.",
  ],
  [
    ShoppingCart,
    "Point of sale",
    "Check out with cash or confirmed transfer and print the recorded sale.",
  ],
  [
    Receipt,
    "Sales history & refunds",
    "Review immutable sales and linked refunds with optional same-branch restocking.",
  ],
  [
    BarChart3,
    "Analytics & planning",
    "Review sales and inventory, forecast demand and consider advisory reorder quantities.",
  ],
  [
    Store,
    "Branch access",
    "Share the catalog while teams work within their assigned roles and branches.",
  ],
] as const;
export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <section
        aria-labelledby="hero-title"
        className="mx-auto max-w-3xl py-16 text-center sm:py-24"
      >
        <Badge variant="outline">Inventory and sales, in one workspace.</Badge>
        <h1
          id="hero-title"
          className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
        >
          Run your inventory with clarity.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-pretty text-muted-foreground sm:text-lg">
          From purchasing and receiving to POS, sales history and analytics. One
          workspace for the everyday operations of SME retail teams.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            nativeButton={false}
            role="link"
            render={<Link href="/register" />}
          >
            Get started
            <ArrowRight />
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            role="link"
            render={<Link href="#features" />}
          >
            View features
          </Button>
        </div>
      </section>
      <section
        aria-label="Illustrative StockWise product preview"
        className="pb-16"
      >
        <Card className="gap-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b pb-4">
            <div className="flex items-center gap-2 font-semibold">
              <Package className="size-4" />
              StockWise / Main branch
            </div>
            <Badge variant="secondary">Illustrative data</Badge>
          </CardHeader>
          <CardContent className="grid gap-6 pt-6 md:grid-cols-[160px_1fr]">
            <div className="hidden space-y-1 border-r pr-4 text-sm md:block">
              {[
                "Overview",
                "Catalog",
                "Inventory",
                "Purchasing",
                "Sales",
                "Analytics",
              ].map((label, i) => (
                <p
                  key={label}
                  className={
                    i === 0
                      ? "rounded-md bg-muted px-3 py-2 font-medium"
                      : "px-3 py-2 text-muted-foreground"
                  }
                >
                  {label}
                </p>
              ))}
            </div>
            <div className="min-w-0 space-y-6">
              <div>
                <p className="text-xs text-muted-foreground">
                  OPERATIONS OVERVIEW
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  A clearer picture of your store
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Net sales", "THB 12,450.00"],
                  ["Completed sales", "42"],
                  ["Products to review", "8"],
                ].map(([label, value]) => (
                  <Card size="sm" key={label}>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-2 text-xl font-semibold tabular-nums">
                        {value}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ["Green tea", "TEA-01", "24", "Stable"],
                      ["Coffee beans", "COF-02", "6", "Reorder review"],
                      ["Paper cups", "CUP-03", "120", "Stable"],
                    ].map((row) => (
                      <TableRow key={row[1]}>
                        <TableCell className="font-medium">{row[0]}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row[1]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row[2]}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row[3]}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Sample values demonstrate existing capabilities. Your workspace
                uses your recorded business data.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
      <section
        id="features"
        aria-labelledby="features-title"
        className="scroll-mt-6 border-t py-16"
      >
        <p className="text-sm text-muted-foreground">
          Built around daily retail work
        </p>
        <h2
          id="features-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          The essentials, connected.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(([Icon, title, description]) => (
            <Card key={title}>
              <CardContent>
                <Icon className="mb-4 size-5" aria-hidden="true" />
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section aria-labelledby="workflow-title" className="border-t py-16">
        <h2
          id="workflow-title"
          className="text-3xl font-semibold tracking-tight"
        >
          A workflow your team can follow.
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-5">
          {[
            ["Purchase", "Create an order with your supplier."],
            ["Receive", "Record arrivals and received costs."],
            ["Stock", "Track balances at the right branch."],
            ["Sell", "Complete checkout and retain the sale."],
            ["Review", "Use analytics to plan the next order."],
          ].map(([title, copy], i) => (
            <li key={title}>
              <p className="text-xs text-muted-foreground">0{i + 1}</p>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {copy}
              </p>
            </li>
          ))}
        </ol>
      </section>
      <section
        aria-labelledby="analytics-title"
        className="grid items-center gap-8 border-t py-16 md:grid-cols-2"
      >
        <div>
          <p className="text-sm text-muted-foreground">
            Records into decisions
          </p>
          <h2
            id="analytics-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            Understand performance. Plan what comes next.
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Review sales, products, branches and inventory with deterministic
            analytics. Forecast demand and review reorder guidance when enough
            history is available.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Saved AI summaries explain aggregate performance. Forecasts remain
            estimates, and purchasing decisions stay with your team.
          </p>
        </div>
        <Card>
          <CardHeader>
            <h3 className="font-semibold">Net sales by reporting period</h3>
            <p className="text-xs text-muted-foreground">
              Illustrative data · THB
            </p>
          </CardHeader>
          <CardContent>
            <div
              className="flex h-40 items-end gap-4 border-b"
              role="img"
              aria-label="Illustrative bar chart: Monday 1200, Tuesday 1800, Wednesday 1500, Thursday 2400, Friday 2100 baht"
            >
              {[50, 75, 62, 100, 87].map((height, i) => (
                <div key={i} className="flex h-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-sm bg-foreground/80"
                    style={{ height: height + "%" }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-5 text-center text-xs text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Sales trends, with exact figures available in your reporting
              tables.
            </p>
          </CardContent>
        </Card>
      </section>
      <section className="flex flex-col justify-between gap-5 border-t py-12 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-semibold">
            Find the right starting point.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Explore proposed plans. Pricing and inclusions are not finalized.
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          role="link"
          render={<Link href="/pricing" />}
        >
          Explore pricing
          <ArrowRight />
        </Button>
      </section>
      <section
        aria-labelledby="cta-title"
        className="mb-16 rounded-xl border bg-muted/40 p-8 text-center sm:p-12"
      >
        <h2 id="cta-title" className="text-3xl font-semibold tracking-tight">
          Bring your retail operations together.
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
          Create an account, verify your email and set up your organization to
          begin.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            nativeButton={false}
            role="link"
            render={<Link href="/register" />}
          >
            Get started
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            role="link"
            render={<Link href="/login" />}
          >
            Sign in
          </Button>
        </div>
      </section>
    </div>
  );
}
