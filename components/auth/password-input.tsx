"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a reveal toggle.
 *
 * Typing a password blind on a phone keyboard is where most failed sign-ins
 * come from, so the toggle is not a nicety.
 *
 * Accessibility notes:
 *  - the button is type="button", or it would submit the form
 *  - aria-pressed conveys the current state to a screen reader, and the label
 *    changes with it
 *  - the field keeps its own id so the caller's <Label htmlFor> still works
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  const describedById = useId();

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Leave room for the button so a long password never sits under it.
        className={cn("h-11 pr-11", className)}
      />

      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-describedby={describedById}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>

      <span id={describedById} className="sr-only">
        {visible
          ? "Your password is currently visible on screen."
          : "Your password is hidden."}
      </span>
    </div>
  );
}
