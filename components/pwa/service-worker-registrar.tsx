'use client';

import { ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

/**
 * Registers the service worker and offers the switch to a new version.
 *
 * The switch is **never** automatic. A worker taking over on its own swaps the
 * assets under an already-loaded page, which breaks chunk loading. Between two
 * sets, you do not reload the app behind someone's back: you offer, they
 * choose.
 *
 * Nothing is registered in development - a service worker cache while you code
 * only produces phantom problems.
 */
export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // Every `setState` lives in an event or promise callback, never in the
    // body of the effect.
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // No `controller` = first install, nothing to announce.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      })
      .catch(() => {
        // Insecure context or registration refused: the app works exactly as
        // before, simply without offline capability.
      });

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div className="shrink-0 border-t border-line bg-accent px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-accent-ink">New version available</p>
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-control bg-accent-ink px-3.5 text-sm font-semibold text-accent transition-transform active:scale-95"
        >
          <ArrowClockwise size={16} weight="bold" />
          Reload
        </button>
      </div>
    </div>
  );
}
