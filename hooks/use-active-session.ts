'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getSessionDetail } from '@/lib/db/queries';
import { getActiveSession } from '@/lib/db/sessions';
import type { SessionDetail } from '@/lib/db/types';

/**
 * `useLiveQuery` rend `undefined` tant que la requête n'a pas abouti — ce qui
 * serait ambigu avec « aucune séance en cours ». La requête renvoie donc
 * toujours un objet : `undefined` signifie alors sans ambiguïté « en cours de
 * chargement », y compris au rendu serveur.
 */
export type ActiveSessionState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; detail: SessionDetail };

/**
 * Séance en cours, réactualisée automatiquement.
 *
 * IndexedDB reste la seule source de vérité : après un `createSet` ou un
 * `addExerciseToSession`, Dexie rejoue cette requête et l'écran se met à jour
 * seul. Aucun état à invalider, aucune copie côté React à resynchroniser.
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
