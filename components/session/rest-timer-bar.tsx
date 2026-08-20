'use client';

import { Timer, X } from '@phosphor-icons/react';
import type { RestProgress } from '@/lib/rest-timer';
import { formatDuration } from '@/lib/format';

interface RestTimerBarProps {
  progress: RestProgress;
  onExtend: (deltaSec: number) => void;
  onDismiss: () => void;
}

const EXTEND_SEC = 30;

/**
 * The rest countdown, between the header and the list.
 *
 * Deliberately **not** above the entry panel: appearing there would push the
 * "Save set" button up the moment a set is logged, and moving that target is
 * exactly what breaks repeating a set in a single tap. At the top the bar takes
 * its room from the scrolling list, which nothing is aiming at.
 *
 * It is also the *only* signal the end of a rest gets. The web cannot alert a
 * phone whose screen is off — iOS has no vibration API at all, and Chrome
 * ignores one from a hidden page — so the bar is built to be read at a glance
 * rather than to supplement a buzz that never comes.
 */
export function RestTimerBar({ progress, onExtend, onDismiss }: RestTimerBarProps) {
  const over = progress.phase === 'over';

  return (
    <section
      aria-label="Rest timer"
      className={`shrink-0 border-b border-line px-4 py-2 ${over ? 'bg-accent' : 'bg-raised'}`}
    >
      <div className="flex items-center gap-3">
        <Timer
          size={18}
          weight="bold"
          className={`shrink-0 ${over ? 'text-accent-ink' : 'text-muted'}`}
        />

        {/* The digits change every second: announcing them would make a screen
            reader unusable. The label carries the meaning instead, and only the
            end of the rest is announced, once. */}
        <p
          aria-hidden
          className={`font-mono text-[1.375rem] leading-none font-semibold tabular-nums ${
            over ? 'text-accent-ink' : 'text-ink'
          }`}
        >
          {over ? formatDuration(progress.overdueSec) : formatDuration(progress.remainingSec)}
        </p>

        <p className={`min-w-0 flex-1 truncate text-sm ${over ? 'text-accent-ink' : 'text-muted'}`}>
          {over ? 'Rest over' : 'Rest'}
        </p>

        <div role="status" aria-live="polite" className="sr-only">
          {over ? 'Rest over' : ''}
        </div>

        <button
          type="button"
          onClick={() => onExtend(EXTEND_SEC)}
          className={`h-11 shrink-0 rounded-control px-3 text-sm font-semibold transition-transform active:scale-95 ${
            over ? 'bg-accent-ink/10 text-accent-ink' : 'bg-surface text-ink'
          }`}
        >
          +{EXTEND_SEC}s
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={over ? 'Dismiss the rest timer' : 'Skip the rest'}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control transition-transform active:scale-95 ${
            over ? 'text-accent-ink' : 'text-muted'
          }`}
        >
          <X size={18} weight="bold" />
        </button>
      </div>

      {/* Drains to nothing, and stays in place once empty. Removing it at the
          end would shorten the bar by its own height and shift every exercise
          row up — moving tap targets under a thumb that is already reaching. */}
      <div
        className={`mt-1.5 h-0.5 w-full overflow-hidden rounded-full ${
          over ? 'bg-accent-ink/15' : 'bg-surface'
        }`}
      >
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-1000 ease-linear"
          style={{ width: `${(1 - progress.fraction) * 100}%` }}
        />
      </div>
    </section>
  );
}
