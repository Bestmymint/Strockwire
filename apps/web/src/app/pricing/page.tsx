import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/marketing/marketing.module.css";

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
    <>
      <section
        className={`${styles.container} ${styles.pricingIntro}`}
        aria-labelledby="pricing-title"
      >
        <p className={styles.eyebrow}>Pre-launch plan concepts</p>
        <h1 id="pricing-title">
          Different stages.
          <br />
          <span>The same clearer view.</span>
        </h1>
        <p>
          From your first store to a growing branch network, explore how
          StockWise can fit the way you work.
        </p>
        <div className={styles.pricingNotice}>
          <strong>Pricing is coming soon.</strong> These are proposed plan
          concepts, not subscriptions available for purchase. Prices, feature
          inclusions, branch and user allowances, and support terms are not
          finalized. The focus areas below describe possible uses of existing
          product capabilities, not feature restrictions.
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.pricingGrid}`}
        aria-label="Proposed plans"
      >
        {plans.map((plan) => (
          <article
            className={styles.pricingCard}
            key={plan.name}
            aria-labelledby={`plan-${plan.name.toLowerCase()}`}
          >
            <p className={styles.eyebrow}>Proposed plan</p>
            <h2 id={`plan-${plan.name.toLowerCase()}`}>{plan.name}</h2>
            <p className={styles.planAudience}>{plan.audience}</p>
            <p className={styles.planPrice}>Coming soon</p>
            <p className={styles.caption}>Subscription price to be announced</p>
            <hr />
            <h3>Planning focus</h3>
            <p>{plan.focus}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <span aria-hidden="true">✓</span>
                  {feature}
                </li>
              ))}
            </ul>
            <Link className={styles.secondaryButton} href="/register">
              Create an account <span aria-hidden="true">↗</span>
            </Link>
          </article>
        ))}
      </section>
      <p className={`${styles.container} ${styles.planFootnote}`}>
        Creating an account starts StockWise’s registration and verification
        flow. It does not select a plan, start a paid subscription, or authorize
        a payment.
      </p>
      <section
        className={`${styles.container} ${styles.pricingQuestions}`}
        aria-labelledby="questions-title"
      >
        <div>
          <p className={styles.eyebrow}>A few things to know</p>
          <h2 id="questions-title">
            Clear expectations.
            <br />
            From the start.
          </h2>
        </div>
        <div>
          <article>
            <h3>Can I purchase a subscription?</h3>
            <p>
              Not yet. This page presents proposed plans. Billing and paid
              subscriptions are not available, and no payment details are
              collected here.
            </p>
          </article>
          <article>
            <h3>Are branch or user limits enforced?</h3>
            <p>
              There are no subscription-based limits or feature entitlements
              implemented. Role-based access still applies to the current
              application.
            </p>
          </article>
          <article>
            <h3>What happens after I create an account?</h3>
            <p>
              Request your verification email, verify your address, and sign in.
              New businesses can then set up an organization and its first
              branch; invited members follow their invitation flow.
            </p>
          </article>
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.finalCta}`}
        aria-labelledby="pricing-cta-title"
      >
        <p className={styles.eyebrow}>Get to know StockWise</p>
        <h2 id="pricing-cta-title">Start with your store’s workflow.</h2>
        <p>
          Explore inventory, purchasing, sales, and planning in one connected
          product.
        </p>
        <div className={styles.actions}>
          <Link className={styles.button} href="/register">
            Get started <span aria-hidden="true">↗</span>
          </Link>
          <Link className={styles.secondaryButton} href="/#features">
            Explore the features
          </Link>
        </div>
      </section>
    </>
  );
}
