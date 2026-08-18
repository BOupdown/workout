'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listSessionSummaries } from '@/lib/db/queries';
import type { SessionSummary } from '@/lib/db/types';

export interface SessionHistory {
  loading: boolean;
  summaries: SessionSummary[];
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Historique paginé, réactualisé automatiquement.
 *
 * Fenêtre **croissante** plutôt que curseur accumulé : sous `useLiveQuery`, une
 * liste accumulée page par page se désynchroniserait dès qu'une séance est
 * clôturée ou supprimée. On refait donc la fenêtre entière, ce qui reste
 * bon marché — `listSessionSummaries` ne lit aucune série, seulement des
 * comptages d'index.
 *
 * On demande un élément de plus que nécessaire : sa présence dit s'il reste
 * quelque chose à charger, sans requête de comptage séparée.
 */
export function useSessionHistory(step = 15): SessionHistory {
  const [limit, setLimit] = useState(step);
  const page = useLiveQuery(() => listSessionSummaries({ limit: limit + 1 }), [limit]);

  return {
    loading: page === undefined,
    summaries: page?.slice(0, limit) ?? [],
    hasMore: (page?.length ?? 0) > limit,
    loadMore: () => setLimit((current) => current + step),
  };
}
