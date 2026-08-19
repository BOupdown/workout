'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getSessionDetail } from '@/lib/db/queries';
import { getActiveSession } from '@/lib/db/sessions';
import type { SessionDetail } from '@/lib/db/types';

/**
 * `useLiveQuery` returns `undefined` until the query resolves - which would be
 * ambiguous with "no session in progress". The query therefore always returns
 * an object, so `undefined` unambiguously means "still loading", including
 * during server rendering.
 */
export type ActiveSessionState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; detail: SessionDetail };

/**
 * The session in progress, kept up to date automatically.
 *
 * IndexedDB stays the single source of truth: after a `createSet` or an
 * `addExerciseToSession`, Dexie replays this query and the screen updates by
 * itself. No state to invalidate, no React-side copy to resynchronise.
 */
export function useActiveSession(): ActiveSessionState {
  const state = useLiveQuery<ActiveSessionState>(async () => {
    const session = await getActiveSession();
    if (!session) return { status: 'none' };

    const detail = await getSessionDetail(session.id);
    return detail ? { status: 'ready', detail } : { status: 'none' };
  }, []);

  return state ?? { status: 'loading' };
}
