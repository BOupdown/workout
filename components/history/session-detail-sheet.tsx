'use client';

import { ArrowLeft, Trash } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import { getSessionDetail } from '@/lib/db/queries';
import { deleteSession } from '@/lib/db/sessions';
import type { Id } from '@/lib/db/types';
import { describeSet, formatElapsed } from '@/lib/format';

interface SessionDetailSheetProps {
  sessionId: Id;
  onClose: () => void;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** A past session, read-only, with its deletion. */
export function SessionDetailSheet({ sessionId, onClose }: SessionDetailSheetProps) {
  const detail = useLiveQuery(() => getSessionDetail(sessionId), [sessionId]);
  const [unit] = useWeightUnit();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const setCount = detail?.entries.reduce((total, entry) => total + entry.sets.length, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close session"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">
            {detail?.title ?? (detail ? DATE_FORMAT.format(detail.startedAt) : 'Session')}
          </h2>
          {detail ? (
            <p className="font-mono text-xs text-muted tabular-nums">
              {TIME_FORMAT.format(detail.startedAt)}
              {detail.endedAt !== undefined
                ? ` · ${formatElapsed(detail.endedAt - detail.startedAt)}`
                : ' · in progress'}
              {` · ${setCount} set${setCount > 1 ? 's' : ''}`}
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
          <p className="py-10 text-center text-sm text-muted">This session has no exercises.</p>
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
                    const { primary, secondary } = describeSet(set, entry.exercise, unit);
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
                        {isWarmup ? <span className="sr-only">(warm-up)</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">No sets</p>
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

        {/* Deletion sits at the bottom of the content, never in the header next
            to the close button: two neighbouring targets where one destroys
            everything is a mis-tap waiting to happen. */}
        {detail ? (
          <section className="pt-2 pb-2">
            {confirming ? (
              <div className="rounded-panel bg-raised px-4 py-3.5">
                <p className="text-sm text-ink">Delete this session permanently?</p>
                <p className="mt-1 text-sm text-muted">
                  {detail.entries.length} exercise{detail.entries.length > 1 ? 's' : ''} and{' '}
                  {setCount} set{setCount > 1 ? 's' : ''} will be lost.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="h-14 flex-1 rounded-control bg-surface text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.98]"
                  >
                    Cancel
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
                    {deleting ? 'Deleting…' : 'Delete'}
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
                Delete session
              </button>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
