"use client";

import Image from "next/image";
import { useActionState } from "react";
import { ArrowLeft, ArrowRight, Star, Trash2, Upload } from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  manageProductImageAction,
  uploadProductImagesAction,
  type ProductActionState,
} from "@/features/products/actions";
import { productImageUrl } from "@/lib/storage/paths";
import { ACCEPT_ATTRIBUTE } from "@/lib/storage/upload";

const EMPTY: ProductActionState = {};

export type ProductImageItem = {
  id: string;
  storagePath: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  position: number;
};

/**
 * Photos.
 *
 * Upload, reorder, set the main image and delete. Every mutation is a form
 * submission to a Server Action - there is no drag-and-drop-only path, so the
 * ordering is fully reachable by keyboard.
 */
export function ImageManager({
  productId,
  productName,
  images,
}: {
  productId: string;
  productName: string;
  images: ProductImageItem[];
}) {
  const [uploadState, upload] = useActionState(
    uploadProductImagesAction,
    EMPTY,
  );
  const [manageState, manage] = useActionState(manageProductImageAction, EMPTY);

  return (
    <div className="space-y-5">
      <form action={upload} className="space-y-3" noValidate>
        <input type="hidden" name="productId" value={productId} />

        <div className="space-y-2">
          <Label htmlFor="product-images">Add photos</Label>
          <Input
            id="product-images"
            name="images"
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="h-11 py-2"
            aria-describedby="product-images-hint"
          />
          <p id="product-images-hint" className="text-xs text-muted-foreground">
            JPEG, PNG, WebP or AVIF. Up to 5MB each, 8 at a time. The first
            photo is the one shown on your catalogue.
          </p>
        </div>

        <FormAlert variant="error">{uploadState.error}</FormAlert>
        <FormAlert variant="success">{uploadState.message}</FormAlert>

        <SubmitButton className="sm:w-auto sm:min-w-40" variant="secondary">
          <Upload aria-hidden="true" />
          Upload
        </SubmitButton>
      </form>

      <FormAlert variant="error">{manageState.error}</FormAlert>
      <FormAlert variant="success">{manageState.message}</FormAlert>

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No photos yet. A clear photo is the single biggest thing that makes a
          catalogue product sell - add at least one before publishing.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <li key={image.id} className="space-y-2 rounded-lg border p-2">
              <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
                <Image
                  src={productImageUrl(image.storagePath)}
                  alt={image.altText || productName}
                  fill
                  sizes="(min-width: 1024px) 200px, 45vw"
                  className="object-cover"
                />
                {index === 0 ? (
                  <span className="absolute top-1 left-1 rounded-md bg-primary px-1.5 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
                    Main
                  </span>
                ) : null}
              </div>

              <form action={manage} className="flex flex-wrap gap-1">
                <input type="hidden" name="productId" value={productId} />
                <input type="hidden" name="imageId" value={image.id} />

                <Button
                  type="submit"
                  name="intent"
                  value="primary"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  title="Make this the main photo"
                >
                  <Star aria-hidden="true" />
                  <span className="sr-only">Make main photo</span>
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="up"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  title="Move earlier"
                >
                  <ArrowLeft aria-hidden="true" />
                  <span className="sr-only">Move earlier</span>
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="down"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === images.length - 1}
                  title="Move later"
                >
                  <ArrowRight aria-hidden="true" />
                  <span className="sr-only">Move later</span>
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="remove"
                  variant="destructive"
                  size="icon-sm"
                  title="Remove photo"
                >
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only">Remove photo</span>
                </Button>
              </form>

              <form action={manage} className="space-y-1">
                <input type="hidden" name="productId" value={productId} />
                <input type="hidden" name="imageId" value={image.id} />
                <input type="hidden" name="intent" value="alt" />
                <Label
                  htmlFor={`alt-${image.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Photo description
                </Label>
                <Input
                  id={`alt-${image.id}`}
                  name="altText"
                  defaultValue={image.altText ?? ""}
                  maxLength={160}
                  placeholder={productName}
                  className="h-9 text-xs"
                />
                <Button type="submit" variant="ghost" size="xs">
                  Save description
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
