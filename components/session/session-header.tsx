'use client';

import { useEffect, useState } from 'react';
import { formatElapsed } from '@/lib/format';
import type { SessionDetail } from '@/lib/db/types';

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

interface SessionHeaderProps {
  detail: SessionDetail;
  onEnd: () => void;
  ending: boolean;
}

export function SessionHeader({ detail, onEnd, ending }: SessionHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const [elapsed, setElapsed] = useState(() => Date.now() - detail.startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - detail.startedAt), 30_000);
    return () => clearInterval(id);
  }, [detail.startedAt]);

  const setCount = detail.entries.reduce((total, entry) => total + entry.sets.length, 0);

  // Majuscule sur la première lettre seulement. `text-transform: capitalize`
  // en mettrait une à chaque mot : « Lundi 17 Août » au lieu de « Lundi 17 août ».
  const day = DAY_FORMAT.format(detail.startedAt);

  return (
    <header className="shrink-0 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-semibold text-ink">
            {detail.title ?? day.charAt(0).toUpperCase() + day.slice(1)}
          </p>
          <p className="mt-1 flex items-center gap-2 font-mono text-xs text-muted tabular-nums">
            <span>{formatElapsed(elapsed)}</span>
            <span aria-hidden className="h-1 w-1 rounded-full bg-line" />
            <span>
              {setCount} série{setCount > 1 ? 's' : ''}
            </span>
          </p>
        </div>

        {confirming ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-11 rounded-control px-3 text-sm font-medium text-muted transition-transform active:scale-95"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onEnd}
              disabled={ending}
              className="h-11 rounded-control bg-ink px-3.5 text-sm font-semibold text-surface transition-transform active:scale-95 disabled:opacity-50"
            >
              {ending ? 'Clôture…' : 'Confirmer'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-11 shrink-0 rounded-control border border-line px-3.5 text-sm font-medium text-ink transition-transform active:scale-95"
          >
            Terminer
          </button>
        )}
      </div>
    </header>
  );
}
