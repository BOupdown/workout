'use client';

import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import { useSessionHistory } from '@/hooks/use-session-history';
import type { Id, SessionSummary, Timestamp } from '@/lib/db/types';
import { formatElapsed } from '@/lib/format';
import { SessionDetailSheet } from './session-detail-sheet';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/**
 * The same day, carrying its year.
 *
 * This list scrolls back as far as the training goes, and a day of the year
 * comes round again every twelve months. The year is dropped for the current
 * one — that is most of what is on screen, and a column repeating "2026" says
 * nothing.
 */
const DATED_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDay(startedAt: Timestamp): string {
  const date = new Date(startedAt);
  const format = date.getFullYear() === new Date().getFullYear() ? DATE_FORMAT : DATED_FORMAT;
  return format.format(date);
}

export function HistoryScreen() {
  const { loading, summaries, hasMore, loadMore } = useSessionHistory();
  const [openSessionId, setOpenSessionId] = useState<Id | null>(null);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <h1 className="text-[0.9375rem] font-semibold text-ink">History</h1>
        <p className="mt-0.5 text-xs text-muted">
          {loading ? 'Loading…' : `${summaries.length}${hasMore ? '+' : ''} session${summaries.length > 1 ? 's' : ''}`}
        </p>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {loading ? (
          [0, 1, 2, 3].map((row) => <div key={row} className="h-20 rounded-panel bg-line" />)
        ) : summaries.length === 0 ? (
          <div className="rounded-panel bg-raised px-4 py-12 text-center">
            <ClockCounterClockwise size={28} weight="duotone" className="mx-auto text-muted" />
            <p className="mt-3 text-sm font-medium text-ink">No finished sessions yet</p>
            <p className="mt-1 text-sm text-muted">
              Your past sessions will show up here, most recent first.
            </p>
          </div>
        ) : (
          <>
            {summaries.map((summary) => (
              <SummaryRow
                key={summary.id}
                summary={summary}
                onOpen={() => setOpenSessionId(summary.id)}
              />
            ))}

            {hasMore ? (
              <button
                type="button"
                onClick={loadMore}
                className="min-h-14 w-full rounded-panel border border-dashed border-line text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.99]"
              >
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>

      {openSessionId ? (
        <SessionDetailSheet sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
      ) : null}
    </div>
  );
}

/**
 * One past session.
 *
 * `content-visibility` because this list only grows: a year of training is a
 * few hundred cards, of which four are on screen. The browser skips layout and
 * paint for the rest until they are scrolled near, and `contain-intrinsic-size`
 * gives it a placeholder height in the meantime so the scrollbar does not lie —
 * `auto` then replaces the estimate with each card's real height once measured.
 */
function SummaryRow({ summary, onOpen }: { summary: SessionSummary; onOpen: () => void }) {
  const day = formatDay(summary.startedAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-panel bg-raised px-4 py-3.5 text-left transition-transform [contain-intrinsic-size:auto_5.5rem] [content-visibility:auto] active:scale-[0.99]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[0.9375rem] font-semibold text-ink">
          {summary.title ?? day}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          {summary.durationMs !== undefined ? formatElapsed(summary.durationMs) : 'in progress'}
        </span>
      </div>

      <p className="mt-1 font-mono text-xs text-muted tabular-nums">
        {/* Every row carries its day: a programme names its sessions, so six
            weeks of "Push" are otherwise six identical rows. It is left out
            when the session has no name, since the headline is then the day
            itself and printing it twice adds nothing. */}
        {summary.title !== undefined ? `${day} · ` : ''}
        {summary.exerciseCount} exercise{summary.exerciseCount > 1 ? 's' : ''}
        {' · '}
        {summary.setCount} set{summary.setCount > 1 ? 's' : ''}
      </p>

      {summary.exerciseNames.length > 0 ? (
        <p className="mt-1.5 truncate text-sm text-muted">
          {summary.exerciseNames.join(', ')}
        </p>
      ) : null}
    </button>
  );
}
