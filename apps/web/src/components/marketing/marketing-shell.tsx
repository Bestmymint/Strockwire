"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";

import styles from "./marketing.module.css";

export function MarketingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <div className={styles.site}>
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <header className={styles.header}>
        <div className={styles.navbar}>
          <Link aria-label="StockWise home" className={styles.brand} href="/">
            <span aria-hidden="true" className={styles.brandMark}>
              S
            </span>
            StockWise<span className={styles.brandDot}>.</span>
          </Link>
          <button
            aria-controls="public-navigation"
            aria-expanded={menuOpen}
            className={styles.menuButton}
            onClick={() => setMenuOpen(!menuOpen)}
            ref={menuButton}
            type="button"
          >
            {menuOpen ? "Close menu" : "Menu"}
          </button>
          <nav
            aria-label="Public navigation"
            className={`${styles.navigation} ${menuOpen ? styles.navOpen : ""}`}
            id="public-navigation"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenuOpen(false);
                menuButton.current?.focus();
              }
            }}
          >
            <Link href="/#features" onClick={() => setMenuOpen(false)}>
              Features
            </Link>
            <Link
              aria-current={pathname === "/pricing" ? "page" : undefined}
              href="/pricing"
              onClick={() => setMenuOpen(false)}
            >
              Pricing
            </Link>
            <Link href="/login" onClick={() => setMenuOpen(false)}>
              Sign in
            </Link>
            <Link
              className={styles.button}
              href="/register"
              onClick={() => setMenuOpen(false)}
            >
              Get started <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className={styles.footer}>
        <div>
          <Link className={styles.brand} href="/">
            StockWise<span className={styles.brandDot}>.</span>
          </Link>
          <p>Inventory, sales, and a clearer view of your business.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/#features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <p className={styles.footerNote}>
          Built for small and medium-sized retailers.
        </p>
      </footer>
    </div>
  );
}
