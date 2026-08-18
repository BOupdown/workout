'use client';

import { useCallback, useEffect, useState } from 'react';

export interface StorageStatus {
  /** L'API Storage est disponible dans ce navigateur. */
  supported: boolean;
  /** `null` tant que la réponse n'est pas connue. */
  persisted: boolean | null;
  usageBytes: number | null;
  requestPersist: () => Promise<void>;
}

const supportsStorageApi = () =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.persisted === 'function';

/**
 * État du stockage durable.
 *
 * `navigator.storage.persist()` demande au navigateur de **ne pas évincer** les
 * données sous pression de stockage. Sans cette demande, IndexedDB fait partie
 * de ce qui est nettoyé en premier quand l'appareil manque de place.
 *
 * Chrome répond selon ses propres heuristiques (app installée, site visité
 * régulièrement), Firefox demande à l'utilisateur. Un refus n'est pas une
 * erreur : il faut juste le dire honnêtement, et proposer une sauvegarde.
 */
export function useStorageStatus(): StorageStatus {
  const supported = supportsStorageApi();

  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  // Incrémenté après une demande, pour relire l'état auprès du navigateur.
  const [reading, setReading] = useState(0);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    // Les valeurs sont posées dans les callbacks des promesses, jamais
    // synchroniquement dans le corps de l'effet.
    navigator.storage.persisted().then(
      (value) => {
        if (!cancelled) setPersisted(value);
      },
      () => {},
    );

    if (typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then(
        (estimate) => {
          if (!cancelled) setUsageBytes(estimate.usage ?? null);
        },
        () => {},
      );
    }

    return () => {
      cancelled = true;
    };
  }, [supported, reading]);

  const requestPersist = useCallback(async () => {
    if (!supported || typeof navigator.storage.persist !== 'function') return;

    await navigator.storage.persist();
    setReading((count) => count + 1);
  }, [supported]);

  return { supported, persisted, usageBytes, requestPersist };
}
