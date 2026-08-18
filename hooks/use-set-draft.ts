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
  /** D'où viennent les valeurs pré-remplies, pour l'annoncer justement. */
  referenceOrigin: DraftReferenceOrigin;
}

/**
 * Brouillon de saisie du bloc actif, pré-rempli.
 *
 * Deux sources de valeurs par défaut, dans cet ordre :
 *   1. la dernière série **de ce bloc** — « je refais la même » ;
 *   2. à défaut, la dernière série de travail de cet exercice, toutes séances
 *      confondues — « je reprends où j'en étais la semaine dernière ».
 *
 * La seconde est exactement ce pour quoi l'index `[exerciseId+performedAt+order]`
 * existe.
 */
export function useSetDraft(block: SessionExerciseWithSets | undefined): SetDraftController {
  const lastInBlock = block?.sets.at(-1);
  const needsHistory = block !== undefined && lastInBlock === undefined;

  const history = useLiveQuery(
    () => (needsHistory ? recentSetsForExercise(block.exerciseId, 1) : undefined),
    [needsHistory, block?.exerciseId],
  );

  const { set: reference, origin } = resolveDraftReference(block, history);

  // État conservé uniquement à partir du moment où l'utilisateur saisit quelque
  // chose. Tant qu'il n'a rien tapé, le brouillon est *dérivé* de la référence,
  // ce qui le laisse se compléter quand la requête d'historique arrive — sans
  // écraser une frappe en cours. La clé est l'identifiant du bloc : changer de
  // bloc repart des valeurs de ce bloc, mais enregistrer une série **conserve**
  // le brouillon, ce qui donne la répétition en un seul tap.
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
