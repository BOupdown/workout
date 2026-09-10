'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { latestPriorSessionSetsForExercise } from '@/lib/db/sets';
import type { SessionExerciseWithSets } from '@/lib/db/types';
import { setFieldRequirements, type SetFieldRequirements } from '@/lib/db/validation';
import {
  draftFromSet,
  EMPTY_DRAFT,
  resolveDraftReference,
  visibleDraftFields,
  type DraftField,
  type DraftReferenceOrigin,
  type SetDraft,
} from '@/lib/set-draft';

export interface SetDraftController {
  draft: SetDraft;
  setField: (field: DraftField, value: string) => void;
  requirements: SetFieldRequirements | undefined;
  visibleFields: DraftField[];
  /** Where the pre-filled values come from, so we can say so accurately. */
  referenceOrigin: DraftReferenceOrigin;
}

/**
 * Pre-filled entry draft for the active block.
 *
 * Set N picks the set at rank N from the latest earlier session containing the
 * exercise. It is a sequence, rather than a "repeat last set" shortcut: a
 * usual ramp of 60 × 10, 80 × 8, 100 × 5 comes back in that same order. A
 * missing historical rank keeps the established same-again fallback.
 */
export function useSetDraft(
  block: SessionExerciseWithSets | undefined,
  sessionStartedAt: number | undefined,
): SetDraftController {
  const setRank = block?.sets.length ?? 0;

  const history = useLiveQuery(
    () =>
      block && sessionStartedAt !== undefined
        ? latestPriorSessionSetsForExercise(block.exerciseId, block.sessionId, sessionStartedAt)
        : undefined,
    [block?.exerciseId, block?.sessionId, sessionStartedAt],
  );

  const { set: reference, origin } = resolveDraftReference(block, history);

  // State is kept only from the moment the user types something. Until then the
  // draft is *derived* from the reference, which lets it fill in when the
  // history query lands without overwriting a keystroke in progress. The rank
  // belongs in the key: after Save, set N + 1 must consult the matching older
  // set, not repeat what the user just entered for set N.
  const draftKey = block ? `${block.id}:${setRank}` : null;
  const [typed, setTyped] = useState<{ key: string; draft: SetDraft } | null>(null);

  const draft =
    block && typed?.key === draftKey
      ? typed.draft
      : draftFromSet(reference, block?.exercise);

  const requirements = block ? setFieldRequirements(block.exercise) : undefined;

  return {
    draft: block ? draft : EMPTY_DRAFT,
    setField: (field, value) => {
      if (!block) return;
      setTyped({ key: draftKey as string, draft: { ...draft, [field]: value } });
    },
    requirements,
    visibleFields: requirements ? visibleDraftFields(requirements) : [],
    referenceOrigin: origin,
  };
}
