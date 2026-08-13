import Link from "next/link";

import { Logo } from "@/components/brand/logo";

const GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/industries", label: "Who it's for" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
      { href: "/refunds", label: "Refunds & cancellation" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-secondary/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Turn your WhatsApp and Instagram business into an organised, growing
            brand.
          </p>
        </div>

        {GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title} className="space-y-3">
            <h2 className="text-sm font-semibold">{group.title}</h2>
            <ul className="space-y-2">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t">
        <p className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} BizSakhi. Built for small businesses.
        </p>
      </div>
    </footer>
  );
}
