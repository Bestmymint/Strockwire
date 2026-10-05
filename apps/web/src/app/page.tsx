import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/marketing/marketing.module.css";

export const metadata: Metadata = {
  title: "StockWise | Smart inventory & sales for SMEs",
  description:
    "Manage branch inventory, purchasing, receiving, POS, and sales with StockWise. Understand performance with analytics, forecasts, and reorder guidance.",
};

const capabilities = [
  {
    symbol: "▦",
    label: "Inventory control",
    title: "Know what’s on your shelves.",
    description:
      "Keep products and categories organized. See stock by branch and trace each change through your inventory movement history.",
    detail: "Catalog · Branch stock · Movement history",
  },
  {
    symbol: "↓",
    label: "Purchasing & receiving",
    title: "Follow every order to arrival.",
    description:
      "Manage suppliers, create purchase orders, and record received items. Keep purchasing, stock, and recorded costs connected.",
    detail: "Suppliers · Purchase orders · Receiving",
  },
  {
    symbol: "↗",
    label: "Point of sale",
    title: "Keep the sale and its story.",
    description:
      "Sell through POS, look up past sales, and view receipts. Handle linked refunds with optional restocking at the original branch.",
    detail: "POS · Sales history · Receipts & refunds",
  },
  {
    symbol: "≋",
    label: "Analytics & planning",
    title: "Make your next move informed.",
    description:
      "Review sales and inventory performance. Use demand forecasts and reorder recommendations to support your replenishment decisions.",
    detail: "KPIs · Forecasts · Reorder guidance",
  },
];

const workflow = [
  {
    title: "Set up your products",
    description:
      "Organize your catalog and suppliers, then give your team access to the right branches.",
  },
  {
    title: "Purchase and receive",
    description:
      "Track purchase orders and record arrivals into branch inventory.",
  },
  {
    title: "Sell and keep track",
    description:
      "Check out through POS and keep sales, receipts, and stock movements connected.",
  },
  {
    title: "Review and replenish",
    description:
      "Explore performance and use planning tools to decide what to order next.",
  },
];

export default function HomePage() {
  return (
    <>
      <section
        className={`${styles.container} ${styles.hero}`}
        aria-labelledby="hero-title"
      >
        <div>
          <p className={styles.eyebrow}>
            <span className={styles.statusDot} /> A clearer view of retail
          </p>
          <h1 id="hero-title">
            Know your stock.
            <br />
            See your sales.
            <br />
            <span>Plan your next move.</span>
          </h1>
          <p className={styles.heroDescription}>
            From the first purchase order to the next reorder, StockWise brings
            your inventory, sales, and analytics together. Built for SME
            retailers and the teams behind them.
          </p>
          <div className={styles.actions}>
            <Link className={styles.button} href="/register">
              Create your account <span aria-hidden="true">↗</span>
            </Link>
            <Link className={styles.secondaryButton} href="#features">
              Explore the features <span aria-hidden="true">↓</span>
            </Link>
          </div>
          <p className={styles.caption}>
            One connected workflow. Across your branches.
          </p>
        </div>
        <figure className={styles.flowBoard}>
          <figcaption>
            <span className={styles.eyebrow}>The connected store</span>
            <strong>Every movement has a next step.</strong>
          </figcaption>
          <div className={styles.flowTrack}>
            <div className={styles.flowItem}>
              <span aria-hidden="true">↓</span>
              <div>
                <strong>Purchase & receive</strong>
                <p>From supplier to stock</p>
              </div>
            </div>
            <div className={`${styles.flowItem} ${styles.flowInventory}`}>
              <span aria-hidden="true">▦</span>
              <div>
                <strong>Branch inventory</strong>
                <p>Know what’s available</p>
              </div>
              <span className={styles.flowTag}>In view</span>
            </div>
            <div className={styles.flowItem}>
              <span aria-hidden="true">↗</span>
              <div>
                <strong>Sell & record</strong>
                <p>POS, receipts, and history</p>
              </div>
            </div>
            <div className={`${styles.flowItem} ${styles.flowPlan}`}>
              <span aria-hidden="true">↻</span>
              <div>
                <strong>Review & replenish</strong>
                <p>Analytics into your next order</p>
              </div>
            </div>
          </div>
          <p className={styles.boardCaption}>
            Illustrative workflow · Decisions stay with you
          </p>
        </figure>
      </section>
      <section
        className={styles.featureSection}
        id="features"
        aria-labelledby="features-title"
      >
        <div className={styles.container}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>
              Your everyday operations, connected
            </p>
            <h2 id="features-title">
              Less guesswork.
              <br />
              More clarity.
            </h2>
            <p>
              For shop owners, store managers, inventory teams, and cashiers who
              need to work from the same records.
            </p>
          </div>
          <div className={styles.featureGrid}>
            {capabilities.map((capability) => (
              <article className={styles.featureCard} key={capability.label}>
                <span aria-hidden="true" className={styles.featureSymbol}>
                  {capability.symbol}
                </span>
                <p className={styles.eyebrow}>{capability.label}</p>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
                <p className={styles.featureDetail}>{capability.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.section}`}
        aria-labelledby="workflow-title"
      >
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>How it works</p>
          <h2 id="workflow-title">A rhythm your store already knows.</h2>
          <p>
            Keep each step connected, from setting up your shelves to planning
            their next refill.
          </p>
        </div>
        <ol className={styles.workflow}>
          {workflow.map((step, index) => (
            <li key={step.title}>
              <span className={styles.stepNumber} aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>
      <section
        className={`${styles.container} ${styles.branchSection}`}
        aria-labelledby="branches-title"
      >
        <div>
          <p className={styles.eyebrow}>One business. Each branch in view.</p>
          <h2 id="branches-title">
            Room for your team.
            <br />
            Clarity for your business.
          </h2>
          <p>
            Share your product catalog and suppliers across the organization
            while keeping stock, purchases, and sales tied to each branch.
          </p>
          <p>
            Give owners and administrators business-wide visibility, and let
            store teams work within their assigned branches.
          </p>
        </div>
        <div className={styles.branchBoard}>
          <p className={styles.eyebrow}>Your organization</p>
          <h3>A shared catalog. Local operations.</h3>
          <div className={styles.branchTiles}>
            <div>
              <strong>Main store</strong>
              <span>Stock · Purchasing · Sales</span>
            </div>
            <div>
              <strong>Another branch</strong>
              <span>Stock · Purchasing · Sales</span>
            </div>
          </div>
          <p>Connected records, with access based on each person’s role.</p>
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.insightSection}`}
        aria-labelledby="insight-title"
      >
        <div>
          <p className={styles.eyebrow}>From records to perspective</p>
          <h2 id="insight-title">
            See the pattern.
            <br />
            Decide the next step.
          </h2>
          <p>
            Explore sales KPIs, inventory movement, and branch performance.
            Forecast observed demand and review advisory reorder quantities when
            enough history is available.
          </p>
          <p>
            Read saved AI-assisted summaries of aggregate performance alongside
            the underlying analytics. Your team stays in charge of purchasing
            and stock decisions.
          </p>
        </div>
        <div className={styles.insightNotes}>
          <div>
            <span>Understand</span>
            <strong>Sales & inventory performance</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>Forecast & reorder guidance</strong>
          </div>
          <div>
            <span>Reflect</span>
            <strong>Saved AI-assisted insights</strong>
          </div>
          <p>
            Forecasts are estimates. Recommendations are guidance, with data
            availability made visible.
          </p>
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.finalCta}`}
        aria-labelledby="cta-title"
      >
        <p className={styles.eyebrow}>Start with a clearer picture</p>
        <h2 id="cta-title">Bring your store’s next chapter into view.</h2>
        <p>
          Create an account to begin the existing verification and setup flow,
          or explore our pre-launch plan concepts.
        </p>
        <div className={styles.actions}>
          <Link className={styles.button} href="/register">
            Get started <span aria-hidden="true">↗</span>
          </Link>
          <Link className={styles.secondaryButton} href="/pricing">
            Explore pricing
          </Link>
        </div>
        <p className={styles.caption}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </>
  );
}
