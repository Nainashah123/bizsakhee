import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const body = (
    <CardContent className="space-y-1.5 pt-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon
          className={cn(
            "size-4 shrink-0",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
            tone === "default" && "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </CardContent>
  );

  if (!href) return <Card>{body}</Card>;

  return (
    <Card className="transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/40">
      <Link href={href} className="block focus:outline-none">
        {body}
      </Link>
    </Card>
  );
}
