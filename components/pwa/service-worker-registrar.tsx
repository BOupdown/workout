'use client';

import { ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

/**
 * Enregistre le service worker et propose la bascule vers une nouvelle version.
 *
 * La bascule n'est **jamais** automatique. Un worker qui prend la main tout seul
 * échange les assets sous une page déjà chargée, ce qui casse le chargement des
 * chunks. Entre deux séries, on ne recharge pas l'app dans le dos de
 * quelqu'un : on lui propose, il choisit.
 *
 * Rien n'est enregistré en développement — un cache de service worker pendant
 * qu'on code ne produit que des faux problèmes.
 */
export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // Les `setState` vivent tous dans des callbacks d'événements ou de
    // promesses, jamais dans le corps de l'effet.
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // `controller` absent = première installation, rien à annoncer.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      })
      .catch(() => {
        // Contexte non sécurisé ou enregistrement refusé : l'app fonctionne
        // exactement comme avant, simplement sans autonomie hors ligne.
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
        <p className="text-sm font-medium text-accent-ink">Nouvelle version disponible</p>
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-control bg-accent-ink px-3.5 text-sm font-semibold text-accent transition-transform active:scale-95"
        >
          <ArrowClockwise size={16} weight="bold" />
          Recharger
        </button>
      </div>
    </div>
  );
}
