'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { recentSetsForExercise } from '@/lib/db/sets';
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
 * Two sources of default values, in this order:
 *   1. the last set **of this block** - "same again";
 *   2. failing that, the last work set of this exercise across every session -
 *      "pick up where I left off last week".
 *
 * The second is exactly what the `[exerciseId+performedAt+order]` index exists
 * for.
 */
export function useSetDraft(block: SessionExerciseWithSets | undefined): SetDraftController {
  const lastInBlock = block?.sets.at(-1);
  const needsHistory = block !== undefined && lastInBlock === undefined;

  const history = useLiveQuery(
    () => (needsHistory ? recentSetsForExercise(block.exerciseId, 1) : undefined),
    [needsHistory, block?.exerciseId],
  );

  const { set: reference, origin } = resolveDraftReference(block, history);

  // State is kept only from the moment the user types something. Until then the
  // draft is *derived* from the reference, which lets it fill in when the
  // history query lands - without overwriting a keystroke in progress. The key
  // is the block id: switching blocks restarts from that block's values, but
  // saving a set **keeps** the draft, which is what gives the one-tap repeat.
  const [typed, setTyped] = useState<{ blockId: string; draft: SetDraft } | null>(null);

  const draft =
    block && typed?.blockId === block.id
      ? typed.draft
      : draftFromSet(reference, block?.exercise);

  const requirements = block ? setFieldRequirements(block.exercise) : undefined;

  return {
    draft: block ? draft : EMPTY_DRAFT,
    setField: (field, value) => {
      if (!block) return;
      setTyped({ blockId: block.id, draft: { ...draft, [field]: value } });
    },
    requirements,
    visibleFields: requirements ? visibleDraftFields(requirements) : [],
    referenceOrigin: origin,
  };
}
