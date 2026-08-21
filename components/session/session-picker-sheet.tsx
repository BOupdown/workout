'use client';

import { ArrowLeft, NotePencil } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listSessionSummaries } from '@/lib/db/queries';
import type { Id } from '@/lib/db/types';
import { MAX_TEMPLATES, sessionTemplates } from '@/lib/session-templates';

interface SessionPickerSheetProps {
  onPick: (sessionId: Id) => void;
  onClose: () => void;
  busy: boolean;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Read wider than we show: grouping by name collapses many into few. */
const SCAN_LIMIT = 60;

/**
 * Choosing which past session to lay out again.
 *
 * Offering to repeat *the last* session was the wrong shape: on a split, the
 * one you want back is almost never the one you just did. Naming a session was
 * already possible and had no payoff — this is the payoff. A routine appears
 * once, by name; everything else is listed by its day.
 */
export function SessionPickerSheet({ onPick, onClose, busy }: SessionPickerSheetProps) {
  const summaries = useLiveQuery(() => listSessionSummaries({ limit: SCAN_LIMIT }), []);
  const templates = summaries ? sessionTemplates(summaries, MAX_TEMPLATES) : undefined;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the session picker"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold text-ink">Start from a past session</h2>
          <p className="text-xs text-muted">Its exercises, none of its sets</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {templates === undefined ? (
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-20 rounded-panel bg-line" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-panel bg-raised px-4 py-10 text-center">
            <p className="text-sm font-medium text-ink">Nothing to reuse yet</p>
            <p className="mt-1 text-sm text-muted">
              Finish a session with a few exercises and it will show up here.
            </p>
          </div>
        ) : (
          <>
            <ul aria-label="Past sessions" className="space-y-2">
              {templates.map((template) => (
                <li key={template.sessionId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(template.sessionId)}
                    className="w-full rounded-panel bg-raised px-4 py-3.5 text-left transition-transform active:scale-[0.99] disabled:opacity-50"
                  >
                    <p className="truncate text-[0.9375rem] font-semibold text-ink">
                      {template.title ?? DAY_FORMAT.format(template.performedAt)}
                    </p>
                    {/* The names are what actually identifies a routine when it
                        has no name — a date alone says nothing about the day. */}
                    <p className="mt-1 truncate text-xs text-muted">
                      {template.exerciseNames.join(' · ')}
                    </p>
                    {template.title !== undefined ? (
                      <p className="mt-1 font-mono text-xs text-muted tabular-nums">
                        last done {DAY_FORMAT.format(template.performedAt)}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            {/* Said here rather than left to be discovered: the list only groups
                what has been named, so naming is what makes it useful. */}
            <p className="mt-4 flex items-start gap-2 px-1 text-xs text-muted">
              <NotePencil size={14} weight="bold" className="mt-0.5 shrink-0" />
              <span>
                Name a session and it appears here once, however many times you have done it.
                Sessions without a name are listed by their day.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
