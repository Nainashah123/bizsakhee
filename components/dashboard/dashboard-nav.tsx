"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  NAV_ITEMS,
  isActivePath,
  type NavItem,
} from "@/components/dashboard/nav-items";
import { can, type WorkspaceRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

function visibleItems(role: WorkspaceRole): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.capability || can(role, item.capability),
  );
}

export function SidebarNav({ role }: { role: WorkspaceRole }) {
  const pathname = usePathname();
  const items = visibleItems(role);

  return (
    <nav aria-label="Dashboard" className="space-y-1">
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="size-4.5 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ role }: { role: WorkspaceRole }) {
  const pathname = usePathname();
  const items = visibleItems(role)
    .filter((item) => item.primary)
    .slice(0, 5);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
