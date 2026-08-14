import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import {
  AiDisclaimer,
  QuotaNote,
  SampleModeNotice,
} from "@/components/ai/ai-notice";
import { ContentPanel } from "@/components/ai/content-panel";
import type { ProductOption, SelectOption } from "@/components/ai/options";
import { SmartReplyPanel } from "@/components/ai/smart-reply-panel";
import { SetupRequired } from "@/components/setup/setup-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AI_OBJECTIVE_LABELS,
  AI_PLATFORM_LABELS,
  AI_TONE_LABELS,
} from "@/lib/ai/prompts";
import { aiProviderStatus } from "@/lib/ai/provider";
import { readAiQuota } from "@/lib/ai/quota";
import {
  AI_LANGUAGES,
  AI_LANGUAGE_LABELS,
  AI_OBJECTIVES,
  AI_PLATFORMS,
  AI_TONES,
} from "@/lib/ai/schemas";
import { requireWorkspace } from "@/lib/auth/session";
import { listProducts } from "@/features/products/queries";
import { formatMoney, isCurrencyCode } from "@/lib/money";
import { can } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "AI helper",
  description:
    "Draft replies to customers and write posts for your products. You read and send them yourself.",
};

/**
 * The AI tools screen.
 *
 * Everything is decided here on the server: the role check, whether a provider
 * is configured at all, and this month's allowance. `lib/ai/*` reads provider
 * keys, so it is never imported by the panels - the option lists are read here
 * and handed down as plain props.
 */

const PRODUCT_PICKER_LIMIT = 60;

function options<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): SelectOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export default async function AiPage() {
  const { workspace } = await requireWorkspace();

  // The routes assert this again on every request; hiding a panel is never the
  // check, it is just the honest thing to show.
  if (!can(workspace.role, "ai.use")) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-warning" aria-hidden="true" />
              The AI helper is not part of your role
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              AI drafting is available to workspace owners and admins. Ask an
              owner if you need access - everything else in BizSakhi is still
              yours to use.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = aiProviderStatus();

  if (!status.configured) {
    return (
      <SetupRequired
        title="Setup required: connect an AI provider"
        summary={`AI_PROVIDER is set to "${status.provider}", but the key it needs has not been provided. Rather than show you a form that would fail, here is exactly what is missing.`}
        steps={[
          {
            label: `Set ${status.missing}`,
            detail:
              status.missing === "ANTHROPIC_API_KEY"
                ? "An API key from console.anthropic.com (sk-ant-…)"
                : "A Vercel AI Gateway key from the Vercel dashboard",
            done: false,
          },
          {
            label: "Or switch to the offline sample provider",
            detail: "AI_PROVIDER=mock - canned templates, no network, no cost",
            done: false,
          },
          {
            label: "Restart the app so the new variables are read",
            detail: "pnpm dev",
            done: false,
          },
        ]}
      />
    );
  }

  const [quota, productList] = await Promise.all([
    readAiQuota(workspace.id),
    listProducts(workspace.id, { status: "published" }),
  ]);

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";

  const products: ProductOption[] = productList.failed
    ? []
    : productList.items.slice(0, PRODUCT_PICKER_LIMIT).map((product) => ({
        id: product.id,
        name: product.name,
        priceLabel: formatMoney(
          product.salePriceMinor ?? product.priceMinor,
          currency,
        ),
      }));

  const tones = options(AI_TONES, AI_TONE_LABELS);
  const languages = options(AI_LANGUAGES, AI_LANGUAGE_LABELS);
  const platforms = options(AI_PLATFORMS, AI_PLATFORM_LABELS);
  const objectives = options(AI_OBJECTIVES, AI_OBJECTIVE_LABELS);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI helper</h1>
        <p className="text-sm text-muted-foreground">
          Draft a reply to a customer, or write a post for one of your products.
          You always read it and send it yourself.
        </p>
      </div>

      {status.provider === "mock" ? <SampleModeNotice /> : null}

      <QuotaNote
        quota={{
          used: quota.used,
          limit: quota.limit,
          remaining: quota.remaining,
        }}
        failed={quota.failed}
      />

      <AiDisclaimer />

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <SmartReplyPanel tones={tones} languages={languages} />
        <ContentPanel
          tones={tones}
          languages={languages}
          platforms={platforms}
          objectives={objectives}
          products={products}
        />
      </div>
    </div>
  );
}
