'use client';

import { DeviceMobile } from '@phosphor-icons/react';
import { useFirstRun } from '@/hooks/use-first-run';

/**
 * Where the training is kept, said once, before anyone has any.
 *
 * Not a tour and not a tunnel: one screen, one sentence, one button. It exists
 * because silence here is not neutral. Someone installing a training app in
 * 2026 assumes it syncs — that is what every other one does — so saying
 * nothing does not leave them without an opinion, it hands them a wrong one.
 * They find out at the worst possible moment: a new phone, and three months
 * gone.
 *
 * It is also, word for word, the reason to use this app rather than another.
 * Stating the principle states both halves at once, so nothing here is a
 * confession — the same sentence that warns is the one that sells.
 *
 * Shown before the first session rather than after: a warning about losing
 * work is worth nothing once the work exists.
 */
export function FirstRunNote() {
  const { pending, acknowledge } = useFirstRun();

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-surface px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <DeviceMobile size={30} weight="duotone" aria-hidden className="text-chart" />

        <h1 className="text-[1.375rem] font-semibold text-ink">Your training stays here</h1>

        <p className="max-w-[32ch] text-[0.9375rem] leading-snug text-muted">
          Everything you log is kept on this phone alone. There is no account and no server —
          nothing is sent anywhere, and nothing is stored anywhere else.
        </p>

        <p className="max-w-[32ch] text-[0.9375rem] leading-snug text-muted">
          Settings can export the whole thing to a file whenever you want it somewhere else.
        </p>
      </div>

      <button
        type="button"
        onClick={acknowledge}
        className="h-16 w-full shrink-0 rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98]"
      >
        Got it
      </button>
    </div>
  );
}
