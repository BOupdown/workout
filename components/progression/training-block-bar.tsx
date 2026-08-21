'use client';

import { Flag, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  deleteTrainingBlock,
  startTrainingBlock,
} from '@/lib/db/training-blocks';
import { localMidnight } from '@/lib/db/keys';
import type { LocalDate } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import { orderBlocks, type BlockProgress, type TrainingBlock } from '@/lib/training-block';

interface TrainingBlockBarProps {
  blocks: TrainingBlock[];
  current: BlockProgress | null;
  today: LocalDate;
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * Where you are in your cycle, and how to move on.
 *
 * The week count is the point, not the colour. "Strength · week 3" answers the
 * question people actually ask a calendar for — is it time to switch — without
 * anyone having to count coloured squares.
 */
export function TrainingBlockBar({ blocks, current, today }: TrainingBlockBarProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [startsOn, setStartsOn] = useState<LocalDate>(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    setBusy(true);
    try {
      await startTrainingBlock(label, startsOn);
      setLabel('');
      setError(null);
      setOpen(false);
    } catch (thrown) {
      setError(
        thrown instanceof ValidationError
          ? (thrown.issues[0]?.message ?? thrown.message)
          : 'Could not start the block. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Training blocks"
        className="flex min-h-11 w-full items-center gap-2 rounded-control bg-surface px-3 text-left transition-transform active:scale-[0.99]"
      >
        <Flag size={15} weight="bold" className="shrink-0 text-ink" />
        {current ? (
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            <span className="font-semibold">{current.block.label}</span>
            <span className="text-muted"> · week {current.week}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-muted">
            No training block
          </span>
        )}
        <Plus size={15} weight="bold" aria-hidden className="shrink-0 text-muted" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-30 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close training blocks"
            onClick={() => setOpen(false)}
            className="flex-1 bg-ink/40"
          />

          <section
            aria-label="Training blocks"
            className="max-h-[88vh] shrink-0 overflow-y-auto rounded-t-panel border-t border-line bg-raised px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
          >
            <h2 className="text-[0.9375rem] font-semibold text-ink">Training blocks</h2>
            <p className="mt-1 text-sm text-muted">
              A block runs until the next one starts, so there is nothing to close.
            </p>

            {error ? (
              <p role="alert" className="mt-3 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-3 space-y-2">
              <input
                type="text"
                autoComplete="off"
                aria-label="Block name"
                placeholder="Strength"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="h-14 w-full rounded-control border-2 border-line bg-surface px-3.5 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
              />

              <input
                type="date"
                aria-label="Block start date"
                value={startsOn}
                onChange={(event) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
                    setStartsOn(event.target.value);
                  }
                }}
                className="h-14 w-full rounded-control border-2 border-line bg-surface px-3.5 font-mono text-base text-ink tabular-nums outline-none focus:border-ink"
              />

              <button
                type="button"
                onClick={handleStart}
                disabled={busy || label.trim() === ''}
                className="h-14 w-full rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                {busy ? 'Starting…' : 'Start this block'}
              </button>
            </div>

            {blocks.length > 0 ? (
              <ul className="mt-4 space-y-1.5">
                {orderBlocks(blocks)
                  .slice()
                  .reverse()
                  .map((block) => (
                    <li
                      key={block.id}
                      className="flex items-center gap-2 rounded-control bg-surface px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {block.label}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                        {DAY_LABEL.format(localMidnight(block.startsOn))}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteTrainingBlock(block.id)}
                        aria-label={`Delete ${block.label}`}
                        className="flex h-11 w-9 shrink-0 items-center justify-center rounded-control text-muted transition-transform active:scale-90"
                      >
                        <Trash size={15} />
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
