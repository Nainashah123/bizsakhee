"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. The digest is the only identifier shown - the
 * message itself may contain internals and stays in the server logs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        message: "client_error_boundary",
        digest: error.digest,
        time: new Date().toISOString(),
      }),
    );
  }, [error]);

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Something went wrong
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page could not load. Trying again usually helps.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
      <Button onClick={reset}>
        <RotateCw aria-hidden="true" /> Try again
      </Button>
    </main>
  );
}
