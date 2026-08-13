import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { SupabaseSetupRequired } from "@/components/setup/setup-required";
import { isSupabaseConfigured } from "@/lib/env";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Without Supabase there is no account system at all, so every auth page
  // would throw. Say so plainly instead.
  if (!isSupabaseConfigured()) return <SupabaseSetupRequired />;

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-secondary/60 to-background">
      <header className="mx-auto w-full max-w-6xl px-4 py-6">
        <Link
          href="/"
          className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Logo />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
