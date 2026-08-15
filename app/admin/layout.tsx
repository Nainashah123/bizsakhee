import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { requirePlatformAdmin } from "@/lib/admin/guard";

export const metadata = {
  title: "Operations",
  // The admin area must never be indexed, linked or previewed anywhere.
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Anyone who is not a platform admin gets a 404 from here, including signed
  // in sellers. Every child page is covered by this one check.
  const admin = await requirePlatformAdmin();

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo showWordmark={false} />
            <span className="text-sm font-semibold">Operations</span>
          </Link>

          <nav aria-label="Operations" className="ml-4 flex items-center gap-1">
            <Link
              href="/admin"
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              Overview
            </Link>
            <Link
              href="/admin/sellers"
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              Sellers
            </Link>
          </nav>

          <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{admin.email}</span>
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted-foreground">
        Every business you open here is recorded in the audit log. Customer
        message content is deliberately not available in this area.
      </footer>
    </div>
  );
}
