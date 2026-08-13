import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { BottomNav, SidebarNav } from "@/components/dashboard/dashboard-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SupabaseSetupRequired } from "@/components/setup/setup-required";
import { isSupabaseConfigured } from "@/lib/env";
import { requireWorkspace } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) return <SupabaseSetupRequired />;

  const { user, workspace } = await requireWorkspace();
  const name = (user.user_metadata?.full_name as string | undefined) ?? "";

  return (
    <div className="flex min-h-full">
      <a
        href="#dashboard-main"
        className="sr-only bg-primary text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="px-5 py-5">
          <Link
            href="/dashboard"
            className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Logo />
          </Link>
        </div>

        <div className="px-3">
          <SidebarNav role={workspace.role} />
        </div>

        <div className="mt-auto px-5 py-4 text-xs text-muted-foreground">
          <p className="truncate font-medium text-foreground">
            {workspace.name}
          </p>
          <p>{ROLE_LABELS[workspace.role]}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
          <Link href="/dashboard" className="lg:hidden">
            <Logo showWordmark={false} />
          </Link>

          <p className="min-w-0 flex-1 truncate text-sm font-semibold lg:text-base">
            {workspace.name}
          </p>

          <UserMenu
            name={name}
            email={user.email ?? ""}
            role={workspace.role}
          />
        </header>

        <main
          id="dashboard-main"
          className="flex-1 px-4 pt-5 pb-24 lg:px-8 lg:pb-10"
        >
          {children}
        </main>
      </div>

      <BottomNav role={workspace.role} />
    </div>
  );
}
