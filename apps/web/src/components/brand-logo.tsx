import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /**
   * Extra classes applied to the logo wrapper. The wrapper is an inline-block
   * box whose width is derived from its height via the logo's aspect ratio, so
   * sizing is controlled with a height utility (e.g. `h-6`, `h-7`, `h-8`).
   */
  className?: string;
  /**
   * Set when the logo is above the fold so both theme variants are
   * priority-loaded and the runtime theme switch is instant.
   */
  priority?: boolean;
}

/**
 * Canonical StockWise brand logo.
 *
 * Both theme variants are rendered and toggled purely with the `dark` class
 * (next-themes `attribute="class"` + Tailwind `@custom-variant dark`), so the
 * correct asset is selected on the server render and switches at runtime
 * without a reload or a hydration workaround.
 *
 * - Light mode: dark/black logo (`logo-light.png`).
 * - Dark mode: white/light logo (`logo-dark.png`).
 *
 * The assets are lossless crops of the supplied 1254x1254 masters with the
 * transparent padding removed, so the logo fills the box without letterboxing.
 */
export function BrandLogo({ className, priority = false }: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label="StockWise"
      className={cn(
        "relative inline-block h-7 w-auto shrink-0 select-none overflow-hidden",
        "aspect-[958/204]",
        className,
      )}
    >
      <Image
        src="/branding/logo-light.png"
        alt=""
        fill
        sizes="200px"
        priority={priority}
        className="object-contain dark:hidden"
      />
      <Image
        src="/branding/logo-dark.png"
        alt=""
        fill
        sizes="200px"
        priority={priority}
        className="hidden object-contain dark:block"
      />
    </span>
  );
}
