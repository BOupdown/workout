'use client';

import { DeviceMobile } from '@phosphor-icons/react';
import { useFirstRun } from '@/hooks/use-first-run';

export function FirstRunNote() {
  const { pending, acknowledge } = useFirstRun();

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-surface px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <DeviceMobile size={30} weight="duotone" aria-hidden className="text-chart" />

        <h1 className="text-[1.375rem] font-semibold text-ink">Your training, on this device and in your account</h1>

        <p className="max-w-[32ch] text-[0.9375rem] leading-snug text-muted">
          Sets are saved on this device first, then synced to your account when you are online.
          Check the sync status before switching devices.
        </p>

        <p className="max-w-[32ch] text-[0.9375rem] leading-snug text-muted">
          Export a backup in Settings for a separate copy of your training.
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
