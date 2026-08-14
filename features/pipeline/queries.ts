import "server-only";

import { createClient } from "@/lib/supabase/server";

export type OpportunityCard = {
  id: string;
  title: string;
  valueMinor: number;
  currency: string;
  contactId: string | null;
  contactName: string | null;
  expectedCloseOn: string | null;
  position: number;
  stageId: string;
};

export type PipelineStageColumn = {
  id: string;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  opportunities: OpportunityCard[];
  totalValueMinor: number;
};

export type PipelineBoard = {
  pipelineId: string;
  pipelineName: string;
  stages: PipelineStageColumn[];
  dealCount: number;
};

export type PipelineBoardResult =
  | { status: "ready"; board: PipelineBoard }
  | { status: "no_pipeline" }
  | { status: "failed" };

/**
 * The default pipeline with its stages and deals.
 *
 * Stages, opportunities and contact names are three separate reads joined in
 * TypeScript - embedded selects are unavailable with hand-written types.
 */
export async function getPipelineBoard(
  workspaceId: string,
): Promise<PipelineBoardResult> {
  const supabase = await createClient();

  const { data: pipelines, error: pipelineError } = await supabase
    .from("pipelines")
    .select("id, name, is_default, created_at")
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (pipelineError) return { status: "failed" };

  const pipeline = pipelines?.[0];
  if (!pipeline) return { status: "no_pipeline" };

  const [
    { data: stages, error: stageError },
    { data: deals, error: dealError },
  ] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, position, is_won, is_lost")
      .eq("workspace_id", workspaceId)
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: true }),
    supabase
      .from("opportunities")
      .select(
        "id, title, value_minor, currency, contact_id, expected_close_on, position, stage_id",
      )
      .eq("workspace_id", workspaceId)
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (stageError || dealError) return { status: "failed" };

  const contactIds = [
    ...new Set(
      (deals ?? [])
        .map((deal) => deal.contact_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const nameById = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, full_name")
      .eq("workspace_id", workspaceId)
      .in("id", contactIds);

    for (const contact of contacts ?? []) {
      nameById.set(contact.id, contact.full_name);
    }
  }

  const byStage = new Map<string, OpportunityCard[]>();
  for (const deal of deals ?? []) {
    const card: OpportunityCard = {
      id: deal.id,
      title: deal.title,
      valueMinor: Number(deal.value_minor ?? 0),
      currency: deal.currency,
      contactId: deal.contact_id,
      contactName: deal.contact_id
        ? (nameById.get(deal.contact_id) ?? null)
        : null,
      expectedCloseOn: deal.expected_close_on,
      position: deal.position,
      stageId: deal.stage_id,
    };
    const bucket = byStage.get(deal.stage_id) ?? [];
    bucket.push(card);
    byStage.set(deal.stage_id, bucket);
  }

  const columns: PipelineStageColumn[] = (stages ?? []).map((stage) => {
    const opportunities = byStage.get(stage.id) ?? [];
    return {
      id: stage.id,
      name: stage.name,
      position: stage.position,
      isWon: stage.is_won,
      isLost: stage.is_lost,
      opportunities,
      totalValueMinor: opportunities.reduce(
        (total, deal) => total + deal.valueMinor,
        0,
      ),
    };
  });

  return {
    status: "ready",
    board: {
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      stages: columns,
      dealCount: deals?.length ?? 0,
    },
  };
}

/** Active contacts, for the "link a customer" select on a deal. */
export async function listContactOptions(
  workspaceId: string,
  limit = 200,
): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("full_name", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({ id: row.id, name: row.full_name }));
}
