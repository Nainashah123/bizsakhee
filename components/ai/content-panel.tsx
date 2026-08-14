"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2, Megaphone, Save, Sparkles } from "lucide-react";

import { CopyField, HashtagField } from "@/components/ai/copy-field";
import type {
  ContentDraft,
  ProductOption,
  SelectOption,
} from "@/components/ai/options";
import { useAiDraft } from "@/components/ai/use-ai-draft";
import { FieldError, FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  saveContentDraftAction,
  type ContentDraftFormState,
} from "@/features/ai/actions";

/**
 * Marketing content.
 *
 * Produces a hook, caption, call to action, hashtags and a WhatsApp version -
 * each copyable on its own, because a seller rarely wants all five at once.
 *
 * Nothing is stored until she presses "Save as draft". Until then the words
 * exist only in her browser and in an audit row that records that a generation
 * happened, never what it said.
 */

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const EMPTY_SAVE: ContentDraftFormState = {};
const OWN_PRODUCT = "";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Save aria-hidden="true" />
      )}
      Save as draft
    </Button>
  );
}

export function ContentPanel({
  tones,
  languages,
  platforms,
  objectives,
  products,
}: {
  tones: SelectOption[];
  languages: SelectOption[];
  platforms: SelectOption[];
  objectives: SelectOption[];
  products: ProductOption[];
}) {
  const ids = {
    product: useId(),
    name: useId(),
    description: useId(),
    price: useId(),
    platform: useId(),
    objective: useId(),
    offer: useId(),
    tone: useId(),
    language: useId(),
    image: useId(),
  };

  const [productId, setProductId] = useState(OWN_PRODUCT);
  const [productName, setProductName] = useState("");
  const [priceLabel, setPriceLabel] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [objective, setObjective] = useState("announce_product");
  const [tone, setTone] = useState("friendly");
  const [language, setLanguage] = useState("en");

  const { state, submit } = useAiDraft<ContentDraft>("/api/ai/content");
  const [saveState, saveAction] = useActionState(
    saveContentDraftAction,
    EMPTY_SAVE,
  );

  const onPickProduct = (value: string) => {
    setProductId(value);
    const product = products.find((item) => item.id === value);
    if (!product) return;
    setProductName(product.name);
    setPriceLabel(product.priceLabel ?? "");
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const optional = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
    };

    void submit({
      productName: productName.trim(),
      productDescription: optional("productDescription"),
      priceLabel: priceLabel.trim() ? priceLabel.trim() : undefined,
      platform,
      objective,
      offer: optional("offer"),
      tone,
      language,
      imageContext: optional("imageContext"),
    });
  };

  const canSubmit = productName.trim().length > 0 && !state.pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-5 text-primary" aria-hidden="true" />
          Marketing content
        </CardTitle>
        <CardDescription>
          A caption, hashtags and a WhatsApp version for one of your products.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {products.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor={ids.product}>Pick a product</Label>
              <select
                id={ids.product}
                value={productId}
                onChange={(event) => onPickProduct(event.target.value)}
                className={SELECT_CLASS}
              >
                <option value={OWN_PRODUCT}>I&apos;ll type it myself</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={ids.name}>Product name</Label>
            <Input
              id={ids.name}
              required
              maxLength={160}
              className="h-11"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              placeholder="Kantha work cotton saree"
              aria-describedby={`${ids.name}-error`}
              aria-invalid={Boolean(state.fieldErrors.productName)}
            />
            <FieldError
              id={`${ids.name}-error`}
              messages={state.fieldErrors.productName}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={ids.description}>
              How would you describe it? (optional)
            </Label>
            <Textarea
              id={ids.description}
              name="productDescription"
              rows={3}
              maxLength={600}
              placeholder="Hand stitched over three weeks, soft cotton, one of a kind"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.price}>Price to show (optional)</Label>
              <Input
                id={ids.price}
                maxLength={40}
                className="h-11"
                value={priceLabel}
                onChange={(event) => setPriceLabel(event.target.value)}
                placeholder="₹2,400"
              />
              <p className="text-xs text-muted-foreground">
                Leave this blank and no price is mentioned. Nothing is invented.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.offer}>Offer (optional)</Label>
              <Input
                id={ids.offer}
                name="offer"
                maxLength={160}
                className="h-11"
                placeholder="Free delivery this week"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.platform}>Where will you post it?</Label>
              <select
                id={ids.platform}
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
                className={SELECT_CLASS}
              >
                {platforms.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.objective}>What is it for?</Label>
              <select
                id={ids.objective}
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                className={SELECT_CLASS}
              >
                {objectives.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.tone}>Tone</Label>
              <select
                id={ids.tone}
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                className={SELECT_CLASS}
              >
                {tones.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.language}>Language</Label>
              <select
                id={ids.language}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className={SELECT_CLASS}
              >
                {languages.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={ids.image}>What is in the photo? (optional)</Label>
            <Input
              id={ids.image}
              name="imageContext"
              maxLength={300}
              className="h-11"
              placeholder="Saree draped over a cane chair, morning light"
            />
          </div>

          <Button
            type="submit"
            size="lg"
            className="h-11 w-full sm:w-auto"
            disabled={!canSubmit}
            aria-busy={state.pending}
          >
            {state.pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            Write the post
          </Button>
        </form>

        {state.error ? (
          <div className="space-y-2">
            <FormAlert variant="error">{state.error}</FormAlert>
            {state.upgradeHref ? (
              <Button asChild variant="outline" size="sm">
                <Link href={state.upgradeHref}>See plans</Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        {state.pending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Writing your post…
          </p>
        ) : null}

        {state.data ? (
          <div className="space-y-4 border-t pt-5">
            <CopyField
              label="Hook"
              value={state.data.hook}
              helper="The first line, before anyone taps 'more'."
            />
            <CopyField
              label="Caption"
              value={state.data.caption}
              tone="primary"
              helper="AI-generated. Check every claim before you post it."
            />
            <CopyField label="Call to action" value={state.data.callToAction} />
            <HashtagField hashtags={state.data.hashtags} />
            <CopyField
              label="WhatsApp version"
              value={state.data.whatsappMessage}
              helper="Shorter, for a broadcast to people who already know you."
            />

            <form action={saveAction} className="space-y-2 border-t pt-4">
              <input type="hidden" name="hook" value={state.data.hook} />
              <input type="hidden" name="caption" value={state.data.caption} />
              <input
                type="hidden"
                name="callToAction"
                value={state.data.callToAction}
              />
              <input
                type="hidden"
                name="hashtags"
                value={state.data.hashtags.join(" ")}
              />
              <input
                type="hidden"
                name="whatsappMessage"
                value={state.data.whatsappMessage}
              />
              <input type="hidden" name="platform" value={platform} />
              <input type="hidden" name="objective" value={objective} />
              <input type="hidden" name="tone" value={tone} />
              <input type="hidden" name="language" value={language} />
              <input type="hidden" name="productId" value={productId} />
              <input
                type="hidden"
                name="generationId"
                value={state.generationId ?? ""}
              />

              <p className="text-xs text-muted-foreground">
                Saving keeps this draft in your workspace and records that you
                approved it. Nothing is saved until you press the button.
              </p>

              <SaveButton />

              {saveState.status === "saved" ? (
                <FormAlert variant="success">{saveState.message}</FormAlert>
              ) : null}
              {saveState.status === "error" ? (
                <FormAlert variant="error">{saveState.error}</FormAlert>
              ) : null}
            </form>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
