import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, KanbanSquare } from "lucide-react";

import { CreatePipelineButton } from "@/components/pipeline/create-pipeline-button";
import { NewDealDialog } from "@/components/pipeline/new-deal-dialog";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getPipelineBoard,
  listContactOptions,
} from "@/features/pipeline/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { formatMoney, isCurrencyCode } from "@/lib/money";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const { workspace } = await requireWorkspace();
  const result = await getPipelineBoard(workspace.id);

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";

  if (result.status === "failed") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              We could not load your pipeline
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              The board did not come back from the database this time. Nothing
              has been lost - try again in a moment.
            </p>
            <Button asChild variant="outline" className="h-10">
              <Link href="/dashboard/pipeline">Try again</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result.status === "no_pipeline") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-center gap-2 text-lg font-semibold">
              <KanbanSquare className="size-5" aria-hidden="true" />
              You do not have a pipeline yet
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              A pipeline is the set of stages an enquiry moves through, from a
              first message to a confirmed order. We can set up the usual five
              stages for you now.
            </p>
            <CreatePipelineButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  const { board } = result;
  const contacts = await listContactOptions(workspace.id);
  const stageOptions = board.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
  }));

  const openValueMinor = board.stages
    .filter((stage) => !stage.isWon && !stage.isLost)
    .reduce((total, stage) => total + stage.totalValueMinor, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {board.pipelineName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {board.dealCount} deal{board.dealCount === 1 ? "" : "s"} -{" "}
            {formatMoney(openValueMinor, currency)} still open. Use{" "}
            <span className="font-medium">Move</span> on any card to change its
            stage.
          </p>
        </div>

        {stageOptions.length > 0 ? (
          <NewDealDialog
            stages={stageOptions}
            contacts={contacts}
            currency={currency}
            defaultStageId={stageOptions[0].id}
          />
        ) : null}
      </div>

      {stageOptions.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-lg font-semibold">This pipeline has no stages</p>
            <p className="max-w-prose text-sm text-muted-foreground">
              Stages are created with the workspace. Without them there is
              nowhere to put a deal.
            </p>
          </CardContent>
        </Card>
      ) : board.dealCount === 0 ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-lg font-semibold">No deals yet</p>
            <p className="max-w-prose text-sm text-muted-foreground">
              Add the enquiry you are working on right now. You can link it to a
              customer and move it through {board.stages.length} stages as it
              progresses.
            </p>
            <div className="flex flex-wrap gap-2">
              <NewDealDialog
                stages={stageOptions}
                contacts={contacts}
                currency={currency}
                defaultStageId={stageOptions[0].id}
                triggerLabel="Add your first deal"
              />
              <Button asChild variant="outline" className="h-10">
                <Link href="/dashboard/contacts">Go to customers</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <PipelineBoard board={board} currency={currency} />
      )}
    </div>
  );
}
