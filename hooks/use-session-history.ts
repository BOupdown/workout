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
 * Paginated history, kept up to date automatically.
 *
 * A **growing window** rather than an accumulated cursor: under `useLiveQuery`,
 * a list accumulated page by page would drift out of sync the moment a session
 * is closed or deleted. So the whole window is refetched, which stays cheap -
 * `listSessionSummaries` reads no set, only index counts.
 *
 * One more item than needed is requested: its presence says whether anything is
 * left to load, with no separate count query.
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
