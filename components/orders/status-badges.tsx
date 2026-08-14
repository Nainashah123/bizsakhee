import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderStatusValue,
  type PaymentStatusValue,
} from "@/lib/validation/orders";

/**
 * Status colour is never the only signal - the label always spells the status
 * out, so the badges stay readable without colour vision.
 */

const ORDER_STATUS_CLASSES: Record<OrderStatusValue, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-secondary text-secondary-foreground",
  in_progress: "bg-accent/15 text-accent",
  ready: "bg-accent/15 text-accent",
  fulfilled: "bg-success/15 text-success-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

const PAYMENT_STATUS_CLASSES: Record<PaymentStatusValue, string> = {
  unpaid: "bg-destructive/10 text-destructive",
  partially_paid: "bg-warning/20 text-warning-foreground",
  paid: "bg-success/15 text-success-foreground",
  refunded: "bg-muted text-muted-foreground",
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatusValue;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        ORDER_STATUS_CLASSES[status],
        className,
      )}
    >
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: PaymentStatusValue;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        PAYMENT_STATUS_CLASSES[status],
        className,
      )}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
