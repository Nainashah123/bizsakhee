import { cn } from "@/lib/utils";

/**
 * BizSakhi mark: a rounded "sakhi" knot — two linked loops suggesting a
 * partnership between the seller and her customers.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8", className)}
    >
      <rect width="32" height="32" rx="10" className="fill-primary" />
      <path
        d="M11 21c-2.5 0-4.2-1.8-4.2-4.2S8.5 12.6 11 12.6c1.9 0 3.1 1 4 2.3l1 1.5 1-1.5c.9-1.3 2.1-2.3 4-2.3 2.5 0 4.2 1.8 4.2 4.2S23.5 21 21 21c-1.9 0-3.1-1-4-2.3"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}

export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {showWordmark ? (
        <span className="text-lg font-semibold tracking-tight">
          Biz<span className="text-accent">Sakhi</span>
        </span>
      ) : null}
      <span className="sr-only">BizSakhi</span>
    </span>
  );
}
