import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappLink } from "@/lib/contacts/normalize";
import { cn } from "@/lib/utils";

/**
 * Opens a WhatsApp chat with this contact. A deep link works with no Meta
 * credentials configured, so it never renders as a dead button.
 */
export function WhatsAppButton({
  phoneNormalized,
  name,
  message,
  size = "default",
  className,
  label,
}: {
  phoneNormalized: string | null;
  name: string;
  message?: string;
  size?: "default" | "sm" | "icon";
  className?: string;
  label?: string;
}) {
  if (!phoneNormalized) return null;

  const text = message ?? `Hi ${name.split(" ")[0]}, `;
  const href = whatsappLink(phoneNormalized, text);
  const accessibleName = `Message ${name} on WhatsApp`;

  return (
    <Button
      asChild
      variant="outline"
      size={size}
      className={cn("text-success", className)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={accessibleName}
        title={accessibleName}
      >
        <MessageCircle aria-hidden="true" />
        {size === "icon" ? null : (label ?? "WhatsApp")}
      </a>
    </Button>
  );
}
