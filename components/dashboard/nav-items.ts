import {
  BarChart3,
  CreditCard,
  KanbanSquare,
  ListTodo,
  Package,
  Plug,
  Receipt,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Capability } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden when the member's role lacks this capability. */
  capability?: Capability;
  /** Shown in the mobile bottom bar (max five). */
  primary?: boolean;
};

/**
 * Navigation is grown alongside the modules. An entry is added here only once
 * its route actually exists, so the sidebar never links to a dead page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: BarChart3, primary: true },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: Settings,
    primary: true,
  },
];

/** Modules landing in later stages, listed here so the plan stays visible. */
export const PLANNED_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/contacts", label: "Customers", icon: Users },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/dashboard/tasks", label: "Follow-ups", icon: ListTodo },
  {
    href: "/dashboard/products",
    label: "Products",
    icon: Package,
    capability: "products.write",
  },
  { href: "/dashboard/orders", label: "Orders", icon: Receipt },
  {
    href: "/dashboard/ai",
    label: "AI helper",
    icon: Sparkles,
    capability: "ai.use",
  },
  {
    href: "/dashboard/team",
    label: "Team",
    icon: Users,
    capability: "members.manage",
  },
  {
    href: "/dashboard/integrations",
    label: "Channels",
    icon: Plug,
    capability: "integrations.manage",
  },
  {
    href: "/dashboard/billing",
    label: "Billing",
    icon: CreditCard,
    capability: "billing.manage",
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
