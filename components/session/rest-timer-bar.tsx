'use client';

import { Timer, X } from '@phosphor-icons/react';
import { useEffect } from 'react';
import type { RestProgress } from '@/lib/rest-timer';
import { formatDuration } from '@/lib/format';

interface RestTimerBarProps {
  progress: RestProgress;
  /** Identifies the current rest, so the buzz fires once per rest, not per render. */
  restKey: number;
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
 */
export function RestTimerBar({ progress, restKey, onExtend, onDismiss }: RestTimerBarProps) {
  const over = progress.phase === 'over';

  useEffect(() => {
    if (!over) return;

    // Chrome refuses to vibrate before the page has been tapped, and *logs an
    // error* when asked anyway. A rest that ends right after a reload is
    // precisely that case, so the same gate is applied here rather than
    // leaving an error in the console on every such reload.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;

    // Android buzzes, iOS ignores this silently — no web API gets a phone to
    // alert reliably from a background tab, so the bar carries the message
    // visually on its own.
    navigator.vibrate?.([120, 60, 120]);
  }, [over, restKey]);

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
