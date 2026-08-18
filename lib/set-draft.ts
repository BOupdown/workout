/**
 * Brouillon de saisie d'une série.
 *
 * Les valeurs sont des **chaînes**, pas des nombres : un champ en cours de
 * frappe vaut « 102, » ou « », qu'aucun `number` ne peut représenter. La
 * conversion n'a lieu qu'à l'enregistrement.
 *
 * Les champs présents sont dictés par `setFieldRequirements()`, la même
 * fonction que celle dont dépend la validation. C'est ce qui rend
 * structurellement impossible de saisir une série que la base refuserait :
 * l'écran ne rend pas un champ interdit, et n'en fabrique donc jamais la valeur.
 */

import type { NewSetInput } from './db/sets';
import type { Exercise, Id, SetKind } from './db/types';
import { setFieldRequirements, type SetFieldRequirements } from './db/validation';
import { formatNumber, parseNumberInput } from './format';

export interface SetDraft {
  weightKg: string;
  reps: string;
  durationSec: string;
}

export type DraftField = keyof SetDraft;

export const EMPTY_DRAFT: SetDraft = { weightKg: '', reps: '', durationSec: '' };

const DRAFT_FIELDS: readonly DraftField[] = ['weightKg', 'reps', 'durationSec'];

/** Exercice réduit à ce dont le brouillon a besoin. */
export type DraftExercise = Pick<Exercise, 'loadType' | 'metric' | 'defaultIncrementKg'>;

/** Champs à afficher, dans l'ordre, pour cet exercice. */
export function visibleDraftFields(requirements: SetFieldRequirements): DraftField[] {
  return DRAFT_FIELDS.filter((field) => requirements[field] === 'required');
}

/**
 * Pré-remplit le brouillon depuis une série de référence — la précédente du
 * bloc, ou à défaut la dernière de cet exercice toutes séances confondues.
 * Un champ non requis reste vide : il ne sera pas affiché.
 */
export function draftFromSet(
  set: Partial<Record<DraftField, number>> | undefined,
  exercise: DraftExercise | undefined,
): SetDraft {
  if (!exercise) return EMPTY_DRAFT;

  const requirements = setFieldRequirements(exercise);
  const read = (field: DraftField): string => {
    const value = set?.[field];
    return requirements[field] === 'required' && value !== undefined ? formatNumber(value) : '';
  };

  return {
    weightKg: read('weightKg'),
    reps: read('reps'),
    durationSec: read('durationSec'),
  };
}

/**
 * Convertit le brouillon en entrée de `createSet`.
 *
 * Un champ requis mais vide ou illisible est **omis**, pas deviné : la
 * validation de la base produit alors son message typé, seule source de vérité.
 */
export function draftToSetInput(
  sessionExerciseId: Id,
  draft: SetDraft,
  exercise: DraftExercise,
  options: { kind?: SetKind } = {},
): NewSetInput {
  const requirements = setFieldRequirements(exercise);
  const input: NewSetInput = { sessionExerciseId };

  if (options.kind !== undefined) input.kind = options.kind;

  for (const field of DRAFT_FIELDS) {
    if (requirements[field] !== 'required') continue;

    const parsed = parseNumberInput(draft[field]);
    if (parsed !== null) input[field] = parsed;
  }

  return input;
}

/** D'où viennent les valeurs pré-remplies. */
export type DraftReferenceOrigin =
  /** Aucune valeur de référence disponible. */
  | 'none'
  /** La série précédente de ce bloc — « je refais la même ». */
  | 'block'
  /** Un autre bloc du même exercice, dans la séance en cours. */
  | 'session'
  /** Une séance antérieure — « je reprends où j'en étais ». */
  | 'history';

export interface DraftReference {
  set: SetReference | undefined;
  origin: DraftReferenceOrigin;
}

type SetReference = Partial<Record<DraftField, number>> & { sessionId: Id };

/**
 * Choisit la série qui sert de valeurs par défaut.
 *
 * L'ordre compte : la dernière série du bloc l'emporte toujours ; à défaut on
 * remonte à la dernière série de travail de cet exercice, qui peut venir d'un
 * autre bloc de la séance en cours aussi bien que d'une séance passée. On
 * distingue les deux pour ne pas annoncer « dernière séance » à propos d'une
 * série enregistrée dix minutes plus tôt.
 */
export function resolveDraftReference(
  block: { sessionId: Id; sets: SetReference[] } | undefined,
  history: SetReference[] | undefined,
): DraftReference {
  if (!block) return { set: undefined, origin: 'none' };

  const lastInBlock = block.sets.at(-1);
  if (lastInBlock) return { set: lastInBlock, origin: 'block' };

  const previous = history?.[0];
  if (!previous) return { set: undefined, origin: 'none' };

  return {
    set: previous,
    origin: previous.sessionId === block.sessionId ? 'session' : 'history',
  };
}

/** Pas des boutons +/- : la charge suit l'exercice, le reste a un pas naturel. */
export function stepForField(field: DraftField, exercise: DraftExercise): number {
  if (field === 'weightKg') return exercise.defaultIncrementKg ?? 2.5;
  if (field === 'durationSec') return 5;
  return 1;
}

/** Applique un pas à un champ, jamais en dessous de zéro. */
export function stepDraftValue(current: string, step: number): string {
  const base = parseNumberInput(current) ?? 0;
  // Réarrondi : 0,1 + 0,2 ne doit pas produire 0,30000000000000004 dans un champ.
  const next = Math.max(0, Math.round((base + step) * 1000) / 1000);
  return formatNumber(next);
}
