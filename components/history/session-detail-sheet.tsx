'use client';

import { ArrowLeft, Trash } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getSessionDetail } from '@/lib/db/queries';
import { deleteSession } from '@/lib/db/sessions';
import type { Id } from '@/lib/db/types';
import { describeSet, formatElapsed } from '@/lib/format';

interface SessionDetailSheetProps {
  sessionId: Id;
  onClose: () => void;
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Une séance passée, en lecture seule, avec sa suppression. */
export function SessionDetailSheet({ sessionId, onClose }: SessionDetailSheetProps) {
  const detail = useLiveQuery(() => getSessionDetail(sessionId), [sessionId]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const day = detail ? DATE_FORMAT.format(detail.startedAt) : '';
  const setCount = detail?.entries.reduce((total, entry) => total + entry.sets.length, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la séance"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">
            {detail?.title ?? (day ? day.charAt(0).toUpperCase() + day.slice(1) : 'Séance')}
          </h2>
          {detail ? (
            <p className="font-mono text-xs text-muted tabular-nums">
              {TIME_FORMAT.format(detail.startedAt)}
              {detail.endedAt !== undefined
                ? ` · ${formatElapsed(detail.endedAt - detail.startedAt)}`
                : ' · en cours'}
              {` · ${setCount} série${setCount > 1 ? 's' : ''}`}
            </p>
          ) : null}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {detail === undefined ? (
          <>
            <div className="h-24 rounded-panel bg-line" />
            <div className="h-24 rounded-panel bg-line" />
          </>
        ) : detail.entries.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Cette séance ne contient aucun exercice.</p>
        ) : (
          detail.entries.map((entry) => (
            <section key={entry.id} className="rounded-panel bg-raised px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-[0.9375rem] font-semibold text-ink">
                  {entry.exercise.name}
                </h3>
                <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                  {entry.sets.length} ×
                </span>
              </div>

              {entry.sets.length > 0 ? (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {entry.sets.map((set) => {
                    const { primary, secondary } = describeSet(set, entry.exercise);
                    const isWarmup = set.kind === 'warmup';
                    return (
                      <li
                        key={set.id}
                        className={`flex items-baseline gap-1 rounded-control bg-surface px-2.5 py-1.5 font-mono tabular-nums ${
                          isWarmup ? 'text-muted' : 'text-ink'
                        }`}
                      >
                        <span className={isWarmup ? 'text-sm' : 'text-base font-semibold'}>
                          {primary}
                        </span>
                        {secondary ? <span className="text-xs text-muted">{secondary}</span> : null}
                        {isWarmup ? <span className="sr-only">(échauffement)</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">Aucune série</p>
              )}

              {entry.notes ? (
                <p className="mt-2 text-sm text-muted italic">{entry.notes}</p>
              ) : null}
            </section>
          ))
        )}

        {detail?.notes ? (
          <section className="rounded-panel bg-raised px-4 py-3.5 text-sm text-muted">
            {detail.notes}
          </section>
        ) : null}

        {/* Suppression en bas du contenu, jamais dans l'en-tete a cote du bouton
            de fermeture : deux cibles voisines dont l'une detruit tout, c'est
            une erreur de tap qui attend de se produire. */}
        {detail ? (
          <section className="pt-2 pb-2">
            {confirming ? (
              <div className="rounded-panel bg-raised px-4 py-3.5">
                {/* Le compte est detache de la phrase : « ses 1 exercice »
                    ne s'accorde pas, alors que cette forme reste juste au
                    singulier comme au pluriel. */}
                <p className="text-sm text-ink">Supprimer définitivement cette séance ?</p>
                <p className="mt-1 text-sm text-muted">
                  {detail.entries.length} exercice{detail.entries.length > 1 ? 's' : ''} et{' '}
                  {setCount} série{setCount > 1 ? 's' : ''} seront perdus.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="h-14 flex-1 rounded-control bg-surface text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.98]"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await deleteSession(sessionId);
                        onClose();
                      } finally {
                        setDeleting(false);
                      }
                    }}
                    className="h-14 flex-1 rounded-control bg-danger text-[0.9375rem] font-semibold text-raised transition-transform active:scale-[0.98] disabled:opacity-50"
                  >
                    {deleting ? 'Suppression…' : 'Supprimer'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-panel text-[0.9375rem] font-medium text-danger transition-transform active:scale-[0.99]"
              >
                <Trash size={17} weight="bold" />
                Supprimer la séance
              </button>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
