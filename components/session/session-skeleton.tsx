'use client';

/**
 * A skeleton shaped like the real screen rather than a generic spinner: coming
 * back to the app between two sets, the layout must not jump once the data
 * lands.
 */
export function SessionSkeleton() {
  return (
    <main className="flex h-full flex-col" aria-busy="true" aria-label="Loading session">
      <div className="shrink-0 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <div className="h-4 w-40 rounded bg-line" />
        <div className="mt-2 h-3 w-24 rounded bg-line" />
      </div>

      <div className="flex-1 space-y-2 p-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded-panel border border-line bg-raised px-4 py-3.5">
            <div className="h-4 w-32 rounded bg-line" />
            <div className="mt-3 flex gap-1.5">
              <div className="h-8 w-16 rounded-control bg-line" />
              <div className="h-8 w-16 rounded-control bg-line" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
