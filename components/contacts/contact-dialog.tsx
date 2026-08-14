"use client";

import { useCallback, useState } from "react";
import { Pencil, UserPlus } from "lucide-react";

import {
  BLANK_CONTACT,
  ContactForm,
  type ContactFormDefaults,
} from "@/components/contacts/contact-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WorkspacePerson } from "@/features/contacts/queries";

export function ContactDialog({
  people,
  defaults,
  mode = "create",
  triggerLabel,
  triggerVariant,
  triggerClassName,
}: {
  people: WorkspacePerson[];
  defaults?: ContactFormDefaults;
  mode?: "create" | "edit";
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = mode === "edit";
  const Icon = isEdit ? Pencil : UserPlus;

  const handleSaved = useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant ?? (isEdit ? "outline" : "default")}
          className={triggerClassName}
        >
          <Icon aria-hidden="true" />
          {triggerLabel ?? (isEdit ? "Edit details" : "Add customer")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit customer" : "Add a customer"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the details you keep for this customer."
              : "A name is enough to start. Add a phone number so you can message them from here."}
          </DialogDescription>
        </DialogHeader>

        <ContactForm
          defaults={defaults ?? BLANK_CONTACT}
          people={people}
          onSaved={handleSaved}
        />
      </DialogContent>
    </Dialog>
  );
}
