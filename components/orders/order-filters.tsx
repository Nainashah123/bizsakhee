"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  type OrderFilters,
} from "@/lib/validation/orders";

const ALL = "all";

/**
 * Filters live in the URL, so a filtered list can be bookmarked, shared and
 * reloaded. Submitting pushes a new query string; the page re-reads it.
 */
export function OrderFiltersBar({ filters }: { filters: OrderFilters }) {
  const router = useRouter();
  const fieldId = useId();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(filters.q);
  const [status, setStatus] = useState<string>(filters.status ?? ALL);
  const [payment, setPayment] = useState<string>(filters.payment ?? ALL);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");

  const isFiltered = Boolean(
    q || filters.status || filters.payment || from || to,
  );

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status !== ALL) params.set("status", status);
    if (payment !== ALL) params.set("payment", payment);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `/dashboard/orders?${query}` : "/dashboard/orders");
    });
  };

  const clear = () => {
    setQ("");
    setStatus(ALL);
    setPayment(ALL);
    setFrom("");
    setTo("");
    startTransition(() => router.push("/dashboard/orders"));
  };

  return (
    <form
      onSubmit={apply}
      className="space-y-3 rounded-xl border bg-card p-3 sm:p-4"
      aria-label="Filter orders"
    >
      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-q`}>Search</Label>
        <Input
          id={`${fieldId}-q`}
          name="q"
          className="h-11"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Order number or customer name"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-status`}>Order status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id={`${fieldId}-status`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {ORDER_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {ORDER_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-payment`}>Payment</Label>
          <Select value={payment} onValueChange={setPayment}>
            <SelectTrigger id={`${fieldId}-payment`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any payment status</SelectItem>
              {PAYMENT_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {PAYMENT_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-from`}>From</Label>
          <Input
            id={`${fieldId}-from`}
            type="date"
            className="h-11"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-to`}>To</Label>
          <Input
            id={`${fieldId}-to`}
            type="date"
            className="h-11"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Search aria-hidden="true" />
          )}
          Apply filters
        </Button>
        {isFiltered ? (
          <Button type="button" variant="ghost" size="lg" onClick={clear}>
            <X aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}
