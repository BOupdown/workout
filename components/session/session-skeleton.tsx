'use client';

/**
 * Squelette calqué sur la forme réelle de l'écran, et non un indicateur
 * générique : au retour de l'app entre deux séries, la mise en page ne doit pas
 * sauter une fois les données arrivées.
 */
export function SessionSkeleton() {
  return (
    <main className="flex h-full flex-col" aria-busy="true" aria-label="Chargement de la séance">
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
