"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { isCurrencyCode, toMinorUnits } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import {
  opportunityCreateSchema,
  opportunityMoveSchema,
} from "@/lib/validation/contacts";

const BOARD_PATH = "/dashboard/pipeline";

export type PipelineActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
};

type StageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
};

/** A stage id from a form is only trusted once it is found in this workspace. */
async function loadStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  stageId: string,
): Promise<StageRow | null> {
  const { data } = await supabase
    .from("pipeline_stages")
    .select("id, pipeline_id, name, is_won, is_lost")
    .eq("workspace_id", workspaceId)
    .eq("id", stageId)
    .maybeSingle();

  return data ?? null;
}

async function nextPositionInStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  stageId: string,
): Promise<number> {
  const { data } = await supabase
    .from("opportunities")
    .select("position")
    .eq("workspace_id", workspaceId)
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1);

  return (data?.[0]?.position ?? -1) + 1;
}

/**
 * Moves a deal to another stage. This is the primary, keyboard-reachable path
 * behind the "Move to stage" control on every card - no pointer required.
 */
export async function moveOpportunityAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(opportunityMoveSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const workspaceId = authorized.data.workspace.id;
  const supabase = await createClient();

  const stage = await loadStage(supabase, workspaceId, parsed.data.stageId);
  if (!stage) return { error: "That stage no longer exists." };

  const { data: deal } = await supabase
    .from("opportunities")
    .select("id, stage_id, pipeline_id")
    .eq("workspace_id", workspaceId)
    .eq("id", parsed.data.opportunityId)
    .maybeSingle();

  if (!deal) return { error: "That deal no longer exists." };
  if (deal.pipeline_id !== stage.pipeline_id) {
    return { error: "That stage belongs to a different pipeline." };
  }
  if (deal.stage_id === stage.id) {
    return { message: `Already in ${stage.name}.` };
  }

  const position = await nextPositionInStage(supabase, workspaceId, stage.id);

  const { error } = await supabase
    .from("opportunities")
    .update({
      stage_id: stage.id,
      position,
      closed_at:
        stage.is_won || stage.is_lost ? new Date().toISOString() : null,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", parsed.data.opportunityId);

  if (error) {
    logger.error("opportunity_move_failed", { code: error.code });
    return { error: "We could not move that deal. Please try again." };
  }

  revalidatePath(BOARD_PATH);
  return { message: `Moved to ${stage.name}.` };
}

const DEFAULT_STAGES = [
  { name: "New enquiry", is_won: false, is_lost: false },
  { name: "In conversation", is_won: false, is_lost: false },
  { name: "Quote sent", is_won: false, is_lost: false },
  { name: "Order confirmed", is_won: true, is_lost: false },
  { name: "Not now", is_won: false, is_lost: true },
];

/**
 * Onboarding creates a pipeline for every new workspace. This exists for the
 * workspaces that somehow have none, so the empty board offers a real action
 * instead of a dead end.
 */
export async function createDefaultPipelineAction(
  _prev: PipelineActionState,
  _formData: FormData,
): Promise<PipelineActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const workspaceId = authorized.data.workspace.id;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("pipelines")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (existing?.length) {
    revalidatePath(BOARD_PATH);
    return { message: "You already have a pipeline." };
  }

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
    return { error: "We could not create your pipeline. Please try again." };
  }

  const { error: stageError } = await supabase.from("pipeline_stages").insert(
    DEFAULT_STAGES.map((stage, index) => ({
      workspace_id: workspaceId,
      pipeline_id: pipeline.id,
      name: stage.name,
      position: index,
      is_won: stage.is_won,
      is_lost: stage.is_lost,
    })),
  );

  if (stageError) {
    logger.error("pipeline_stage_insert_failed", { code: stageError.code });
    return { error: "We created the pipeline but not its stages." };
  }

  revalidatePath(BOARD_PATH);
  return { message: "Your pipeline is ready." };
}

export async function createOpportunityAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(opportunityCreateSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace, user } = authorized.data;
  const supabase = await createClient();

  const stage = await loadStage(supabase, workspace.id, parsed.data.stageId);
  if (!stage) return { error: "Pick a stage that exists in your pipeline." };

  if (parsed.data.contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("id", parsed.data.contactId)
      .maybeSingle();
    if (!contact) return { error: "That customer no longer exists." };
  }

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";

  let valueMinor = 0;
  if (parsed.data.value) {
    try {
      valueMinor = toMinorUnits(parsed.data.value, currency);
    } catch {
      return {
        error: "Please check the highlighted fields.",
        fieldErrors: { value: ["Enter an amount like 2500 or 2500.50"] },
      };
    }
  }

  const position = await nextPositionInStage(supabase, workspace.id, stage.id);

  const { error } = await supabase.from("opportunities").insert({
    workspace_id: workspace.id,
    pipeline_id: stage.pipeline_id,
    stage_id: stage.id,
    contact_id: parsed.data.contactId ?? null,
    title: parsed.data.title,
    value_minor: valueMinor,
    currency,
    expected_close_on: parsed.data.expectedCloseOn ?? null,
    position,
    created_by: user.id,
    closed_at: stage.is_won || stage.is_lost ? new Date().toISOString() : null,
  });

  if (error) {
    logger.error("opportunity_insert_failed", { code: error.code });
    return { error: "We could not save that deal. Please try again." };
  }

  revalidatePath(BOARD_PATH);
  return { message: `"${parsed.data.title}" added to ${stage.name}.` };
}
