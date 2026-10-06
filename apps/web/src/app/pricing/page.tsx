import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "StockWise pricing | Pre-launch plan concepts",
  description:
    "Explore Starter, Growth, and Business plan concepts for SME retail operations. StockWise subscription prices and inclusions are not yet finalized.",
};

const plans = [
  {
    name: "Starter",
    audience: "For a small, single-location shop.",
    focus: "Get the everyday essentials connected.",
    features: [
      "Organize products and suppliers",
      "Track stock and receiving",
      "Connect POS with sales history",
      "Understand everyday performance",
    ],
  },
  {
    name: "Growth",
    audience: "For a growing retail business.",
    focus: "Keep teams and locations in step.",
    features: [
      "Coordinate purchasing and inventory",
      "Review performance across branches",
      "Give teams access by role",
      "Plan with forecast and reorder tools",
    ],
  },
  {
    name: "Business",
    audience: "For a larger branch network.",
    focus: "See the business beyond each counter.",
    features: [
      "Organize multi-branch operations",
      "Maintain organization-wide visibility",
      "Review branch and product trends",
      "Read saved aggregate AI insights",
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <section
        aria-labelledby="pricing-title"
        className="mx-auto max-w-2xl text-center"
      >
        <Badge variant="outline">Pre-launch plan concepts</Badge>
        <h1
          id="pricing-title"
          className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl"
        >
          A starting point for every stage.
        </h1>
        <p className="mt-5 leading-7 text-muted-foreground">
          From your first store to a growing branch network, explore how
          StockWise can fit the way you work.
        </p>
      </section>
      <Alert className="my-10">
        <AlertTitle>Pricing is coming soon.</AlertTitle>
        <AlertDescription>
          These are proposed plan concepts, not subscriptions available for
          purchase. Prices, feature inclusions, branch and user allowances, and
          support terms are not finalized. The focus areas below describe
          possible uses of existing product capabilities, not feature
          restrictions.
        </AlertDescription>
      </Alert>
      <section
        aria-label="Proposed plans"
        className="grid gap-5 md:grid-cols-3"
      >
        {plans.map((plan) => (
          <article
            key={plan.name}
            aria-labelledby={"plan-" + plan.name.toLowerCase()}
          >
            <Card className="h-full">
              <CardHeader>
                <Badge variant="secondary" className="w-fit">
                  Proposed plan
                </Badge>
                <h2
                  id={"plan-" + plan.name.toLowerCase()}
                  className="mt-2 text-xl font-semibold"
                >
                  {plan.name}
                </h2>
                <CardDescription>{plan.audience}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-5">
                <div>
                  <p className="text-3xl font-semibold tracking-tight">
                    Coming soon
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Subscription price to be announced
                  </p>
                </div>
                <Separator />
                <div>
                  <h3 className="font-medium">Planning focus</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {plan.focus}
                  </p>
                </div>
                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      className="flex items-start gap-2 text-sm"
                      key={feature}
                    >
                      <Check
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  className="mt-auto"
                  nativeButton={false}
                  role="link"
                  render={<Link href="/register" />}
                >
                  Create an account
                  <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          </article>
        ))}
      </section>
      <p className="mt-6 text-sm leading-6 text-muted-foreground">
        Creating an account starts StockWise’s registration and verification
        flow. It does not select a plan, start a paid subscription, or authorize
        a payment.
      </p>
      <section className="mt-16 border-t pt-10">
        <h2 className="text-2xl font-semibold">Explore the product first.</h2>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          StockWise brings inventory, purchasing, receiving, POS and reporting
          together. Proposed plans do not introduce feature restrictions in the
          current application.
        </p>
        <Button
          className="mt-5"
          variant="outline"
          nativeButton={false}
          role="link"
          render={<Link href="/#features" />}
        >
          View features
        </Button>
      </section>
    </div>
  );
}
