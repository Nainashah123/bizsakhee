import { Skeleton } from "@/components/ui/skeleton";

export default function StorefrontLoading() {
  return (
    <div
      className="min-h-dvh bg-background"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading catalogue</span>

      <div className="border-b bg-card">
        <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-10 sm:py-14">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-full max-w-prose" />
          <Skeleton className="h-11 w-56 rounded-lg" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-80 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
