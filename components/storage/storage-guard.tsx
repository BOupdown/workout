'use client';

import { WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { db } from '@/lib/db/db';

type Status = 'checking' | 'ready' | 'unavailable';

/**
 * Garde-fou sur la disponibilité d'IndexedDB.
 *
 * Sans lui, un navigateur où le stockage est bloqué — navigation privée sur
 * certains moteurs, réglage de confidentialité strict — donnait un écran cassé
 * sans explication. Toute l'app repose sur cette base : si elle ne s'ouvre pas,
 * il faut le dire, pas laisser l'utilisateur face à un chargement infini.
 *
 * Les enfants sont rendus tant que le verdict n'est pas tombé : chaque écran a
 * déjà son propre état de chargement, et un écran de garde supplémentaire ne
 * ferait qu'ajouter un clignotement.
 */
export function StorageGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    db.open().then(
      () => !cancelled && setStatus('ready'),
      () => !cancelled && setStatus('unavailable'),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'unavailable') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <WarningCircle size={32} weight="duotone" className="text-muted" />
        <h1 className="mt-4 text-lg font-semibold text-ink">Stockage indisponible</h1>
        <p className="mt-2 max-w-[32ch] text-sm text-muted">
          Cette app enregistre tes séances sur ton appareil, et ton navigateur ne l’y autorise pas.
          En navigation privée, essaie une fenêtre normale ; sinon, vérifie que les données de site
          sont autorisées.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
