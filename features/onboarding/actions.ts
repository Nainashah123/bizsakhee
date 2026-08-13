"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createFirstWorkspace } from "@/features/onboarding/service";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import { onboardingSchema } from "@/lib/validation/onboarding";

export type OnboardingState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = parseFormData(onboardingSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();

  // A second workspace is a separate flow; onboarding is for the first one.
  const { count } = await supabase
    .from("workspace_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) > 0) redirect("/dashboard");

  const result = await createFirstWorkspace(supabase, user.id, parsed.data);
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
