import { Archive, CircleCheck, PencilLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  PRODUCT_STATUS_LABELS,
  STOCK_STATUS_LABELS,
  type ProductStatusValue,
  type StockStatusValue,
} from "@/lib/validation/products";

const STATUS_VARIANT: Record<
  ProductStatusValue,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  draft: "secondary",
  published: "default",
  archived: "outline",
};

const STATUS_ICON = {
  draft: PencilLine,
  published: CircleCheck,
  archived: Archive,
} as const;

export function ProductStatusBadge({ status }: { status: ProductStatusValue }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      <Icon aria-hidden="true" />
      {PRODUCT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function StockBadge({
  stockStatus,
  quantity,
}: {
  stockStatus: StockStatusValue;
  quantity: number | null;
}) {
  const label = STOCK_STATUS_LABELS[stockStatus];
  const suffix =
    stockStatus === "in_stock" && quantity !== null ? ` (${quantity})` : "";

  return (
    <span
      className={
        stockStatus === "out_of_stock"
          ? "text-xs font-medium text-destructive"
          : "text-xs font-medium text-muted-foreground"
      }
    >
      {label}
      {suffix}
    </span>
  );
}
