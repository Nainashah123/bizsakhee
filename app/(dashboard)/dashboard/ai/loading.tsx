import { Skeleton } from "@/components/ui/skeleton";

export default function AiLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the AI helper</span>

      <div className="space-y-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-28 rounded-xl" />

      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="space-y-4 rounded-xl border p-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-24 rounded-lg" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
            </div>
            <Skeleton className="h-11 w-40 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
