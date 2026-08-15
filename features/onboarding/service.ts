import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePhone } from "@/lib/contacts/normalize";
import { countryByCode } from "@/lib/geo/countries";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import type { Database } from "@/lib/supabase/database.types";
import type { OnboardingInput } from "@/lib/validation/onboarding";

type Client = SupabaseClient<Database>;

const DEFAULT_STAGES = [
  { name: "New enquiry", is_won: false, is_lost: false },
  { name: "In conversation", is_won: false, is_lost: false },
  { name: "Quote sent", is_won: false, is_lost: false },
  { name: "Order confirmed", is_won: true, is_lost: false },
  { name: "Not now", is_won: false, is_lost: true },
];

export type OnboardingResult = { workspaceId: string; slug: string };

/**
 * Creates the first workspace for a user.
 *
 * Ordering matters: the workspace row must exist before the membership (the
 * RLS bootstrap policy checks `workspaces.owner_id`), and the membership must
 * exist before anything that requires admin rights. Supabase has no
 * client-side transaction, so each step is checked and a failure part-way
 * through is reported rather than silently half-applied.
 */
export async function createFirstWorkspace(
  supabase: Client,
  userId: string,
  input: OnboardingInput,
): Promise<Result<OnboardingResult>> {
  const { data: slug, error: slugError } = await supabase.rpc(
    "allocate_workspace_slug",
    { desired: input.businessName },
  );

  if (slugError || !slug) {
    logger.error("workspace_slug_allocation_failed", { code: slugError?.code });
    return err("unknown", "We could not set up your workspace. Please retry.");
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      name: input.businessName,
      slug,
      owner_id: userId,
      currency: input.currency,
      country: input.country,
      timezone: countryByCode(input.country).timezone,
    })
    .select("id, slug")
    .single();

  if (workspaceError || !workspace) {
    logger.error("workspace_insert_failed", { code: workspaceError?.code });
    return err("unknown", "We could not create your workspace. Please retry.");
  }

  const { error: memberError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: userId, role: "owner" });

  if (memberError) {
    logger.error("workspace_member_insert_failed", { code: memberError.code });
    return err("unknown", "We could not finish setting up your workspace.");
  }

  const whatsapp = normalizePhone(input.whatsappNumber, input.country);

  const { error: businessError } = await supabase
    .from("business_profiles")
    .insert({
      workspace_id: workspace.id,
      business_name: input.businessName,
      category: input.category,
      city: input.city || null,
      country: input.country,
      primary_channel: input.primaryChannel,
      whatsapp_number: whatsapp?.normalized ?? null,
    });

  if (businessError) {
    logger.error("business_profile_insert_failed", {
      code: businessError.code,
    });
    return err("unknown", "We could not save your business details.");
  }

  await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      preferred_language: input.language,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", userId);

  const pipelineResult = await createDefaultPipeline(supabase, workspace.id);
  if (!pipelineResult.ok) return pipelineResult;

  if (input.includeDemoData) {
    const demo = await seedDemoData(
      supabase,
      workspace.id,
      userId,
      pipelineResult.data.firstStageId,
      input.currency,
    );
    // Demo data is a convenience: if it fails the workspace is still usable.
    if (!demo.ok) {
      logger.warn("demo_data_seed_failed", { workspaceId: workspace.id });
    }
  }

  return ok({ workspaceId: workspace.id, slug: workspace.slug });
}

async function createDefaultPipeline(
  supabase: Client,
  workspaceId: string,
): Promise<Result<{ pipelineId: string; firstStageId: string }>> {
  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .insert({
      workspace_id: workspaceId,
      name: "Sales pipeline",
      is_default: true,
    })
    .select("id")
    .single();

  if (pipelineError || !pipeline) {
    logger.error("pipeline_insert_failed", { code: pipelineError?.code });
    return err("unknown", "We could not create your default pipeline.");
  }

  const { data: stages, error: stageError } = await supabase
    .from("pipeline_stages")
    .insert(
      DEFAULT_STAGES.map((stage, index) => ({
        workspace_id: workspaceId,
        pipeline_id: pipeline.id,
        name: stage.name,
        position: index,
        is_won: stage.is_won,
        is_lost: stage.is_lost,
      })),
    )
    .select("id, position")
    .order("position", { ascending: true });

  if (stageError || !stages?.length) {
    logger.error("pipeline_stage_insert_failed", { code: stageError?.code });
    return err("unknown", "We could not create your pipeline stages.");
  }

  return ok({ pipelineId: pipeline.id, firstStageId: stages[0].id });
}

/**
 * Sample data, created only when the user explicitly asks for it. Everything
 * is obviously named as a sample so it is never mistaken for a real customer.
 */
async function seedDemoData(
  supabase: Client,
  workspaceId: string,
  userId: string,
  stageId: string,
  currency: string,
): Promise<Result<null>> {
  const { data: contacts, error: contactError } = await supabase
    .from("contacts")
    .insert([
      {
        workspace_id: workspaceId,
        full_name: "Sample - Meera Nair",
        phone_normalized: "919000000001",
        phone_display: "+91 90000 00001",
        city: "Kochi",
        lead_source: "Instagram",
        created_by: userId,
      },
      {
        workspace_id: workspaceId,
        full_name: "Sample - Ritu Sharma",
        phone_normalized: "919000000002",
        phone_display: "+91 90000 00002",
        city: "Jaipur",
        lead_source: "WhatsApp status",
        created_by: userId,
      },
    ])
    .select("id");

  if (contactError || !contacts?.length) return err("unknown", "seed failed");

  const { error: productError } = await supabase.from("products").insert({
    workspace_id: workspaceId,
    name: "Sample - Cotton kurta set",
    slug: "sample-cotton-kurta-set",
    description: "A sample product so you can see how your catalogue looks.",
    price_minor: 149900,
    currency,
    status: "draft",
    created_by: userId,
  });

  if (productError) return err("unknown", "seed failed");

  const { error: opportunityError } = await supabase
    .from("opportunities")
    .insert({
      workspace_id: workspaceId,
      pipeline_id: (
        await supabase
          .from("pipeline_stages")
          .select("pipeline_id")
          .eq("id", stageId)
          .single()
      ).data?.pipeline_id as string,
      stage_id: stageId,
      contact_id: contacts[0].id,
      title: "Sample - Festive order enquiry",
      value_minor: 299900,
      currency,
      created_by: userId,
    });

  if (opportunityError) return err("unknown", "seed failed");

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 1);

  const { error: taskError } = await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    title: "Sample - Follow up with Meera about the kurta set",
    due_at: dueAt.toISOString(),
    contact_id: contacts[0].id,
    assigned_to: userId,
    created_by: userId,
  });

  if (taskError) return err("unknown", "seed failed");

  return ok(null);
}
