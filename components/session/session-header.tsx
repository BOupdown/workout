'use client';

import { NotePencil } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { getBodyWeight } from '@/lib/db/bodyweight';
import { listTrainingBlocks } from '@/lib/db/training-blocks';
import { blockProgressOn } from '@/lib/training-block';
import { formatElapsed, formatNumber } from '@/lib/format';
import type { SessionDetail } from '@/lib/db/types';
import { toDisplayWeight, type WeightUnit } from '@/lib/units';

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

interface SessionHeaderProps {
  detail: SessionDetail;
  onEnd: () => void;
  ending: boolean;
  unit: WeightUnit;
  onEditBodyweight: () => void;
  onEditNotes: () => void;
}

export function SessionHeader({
  detail,
  onEnd,
  ending,
  unit,
  onEditBodyweight,
  onEditNotes,
}: SessionHeaderProps) {
  const [confirming, setConfirming] = useState(false);

  // Read from the timeline rather than from the session: the session holds no
  // copy, so the header and the calendar cannot show different numbers.
  const bodyweight = useLiveQuery(() => getBodyWeight(detail.date), [detail.date]);

  // Shown here because knowing you are in week 3 of a strength block matters
  // while deciding today's sets, not while browsing a calendar afterwards.
  const blocks = useLiveQuery(() => listTrainingBlocks(), []);
  const block = blockProgressOn(blocks ?? [], detail.date);
  const [elapsed, setElapsed] = useState(() => Date.now() - detail.startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - detail.startedAt), 30_000);
    return () => clearInterval(id);
  }, [detail.startedAt]);

  const setCount = detail.entries.reduce((total, entry) => total + entry.sets.length, 0);

  const day = DAY_FORMAT.format(detail.startedAt);

  return (
    <header className="shrink-0 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The name was displayed and never settable. Tapping it is the way
              in: it is the one place where "this is Push A" is on your mind. */}
          <button
            type="button"
            onClick={onEditNotes}
            aria-label="Name this session, and add notes"
            className="-ml-1 flex min-h-8 max-w-full items-center gap-1.5 rounded-control px-1 text-left transition-transform active:scale-[0.98]"
          >
            <span className="truncate text-[0.9375rem] font-semibold text-ink">
              {detail.title ?? day}
            </span>
            <NotePencil size={15} weight="bold" className="shrink-0 text-muted" />
          </button>
          <p className="mt-1 flex items-center gap-2 font-mono text-xs text-muted tabular-nums">
            <span>{formatElapsed(elapsed)}</span>
            <span aria-hidden className="h-1 w-1 rounded-full bg-line" />
            <span>
              {setCount} set{setCount > 1 ? 's' : ''}
            </span>
            {block ? (
              <>
                <span aria-hidden className="h-1 w-1 rounded-full bg-line" />
                <span className="truncate font-sans">
                  {block.block.label} w{block.week}
                </span>
              </>
            ) : null}
            <span aria-hidden className="h-1 w-1 rounded-full bg-line" />
            {/* Small on purpose — it is read at a glance and set once — but the
                pseudo-element gives it a full-size touch target without pushing
                the header taller. */}
            <button
              type="button"
              onClick={onEditBodyweight}
              className="relative font-sans font-medium text-ink underline decoration-line underline-offset-4 transition-transform active:scale-95 after:absolute after:-inset-x-3 after:-inset-y-3 after:content-['']"
            >
              {bodyweight !== undefined
                ? `${formatNumber(toDisplayWeight(bodyweight.weightKg, unit))} ${unit}`
                : 'Bodyweight'}
            </button>
          </p>
        </div>

        {confirming ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-11 rounded-control px-3 text-sm font-medium text-muted transition-transform active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onEnd}
              disabled={ending}
              className="h-11 rounded-control bg-ink px-3.5 text-sm font-semibold text-surface transition-transform active:scale-95 disabled:opacity-50"
            >
              {ending ? 'Closing…' : 'Confirm'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-11 shrink-0 rounded-control border border-line px-3.5 text-sm font-medium text-ink transition-transform active:scale-95"
          >
            Finish
          </button>
        )}
      </div>
    </header>
  );
}
