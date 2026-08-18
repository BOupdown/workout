/**
 * Brouillon de création d'un exercice personnalisé.
 *
 * Même doctrine que `./set-draft` : les valeurs sont des chaînes tant que
 * l'utilisateur tape, et le formulaire ne peut pas produire un exercice que la
 * base refuserait — un champ dépourvu de sens pour la nature choisie n'est pas
 * affiché, donc sa valeur n'est jamais émise.
 */

import type { NewExerciseInput } from './db/exercises';
import type { EffortMetric, Exercise, LoadType, MuscleGroup } from './db/types';
import { parseNumberInput } from './format';

export interface ExerciseDraft {
  name: string;
  loadType: LoadType;
  metric: EffortMetric;
  perSide: boolean;
  /** Chaîne vide = non renseigné. */
  muscleGroup: MuscleGroup | '';
  defaultIncrementKg: string;
}

export const EMPTY_EXERCISE_DRAFT: ExerciseDraft = {
  name: '',
  loadType: 'external',
  metric: 'reps',
  perSide: false,
  muscleGroup: '',
  defaultIncrementKg: '',
};

/**
 * Libellés en langage de salle. « loadType » et « metric » sont du jargon de
 * modèle de données : personne ne choisit un « weighted_bodyweight ».
 */
export const LOAD_TYPE_OPTIONS: { value: LoadType; label: string; hint: string }[] = [
  { value: 'external', label: 'Avec une charge', hint: 'barre, haltères, machine' },
  { value: 'bodyweight', label: 'Poids du corps', hint: 'sans charge à saisir' },
  { value: 'weighted_bodyweight', label: 'Poids du corps + lest', hint: 'ceinture, gilet' },
  { value: 'assisted', label: 'Assisté', hint: 'machine ou élastique qui allège' },
];

export const METRIC_OPTIONS: { value: EffortMetric; label: string }[] = [
  { value: 'reps', label: 'Répétitions' },
  { value: 'time', label: 'Durée' },
];

/** `Record` et non tableau : ajouter un groupe sans le nommer ne compile pas. */
export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Pectoraux',
  back: 'Dos',
  shoulders: 'Épaules',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Avant-bras',
  quads: 'Quadriceps',
  hamstrings: 'Ischio-jambiers',
  glutes: 'Fessiers',
  calves: 'Mollets',
  core: 'Gainage',
  fullbody: 'Corps entier',
  cardio: 'Cardio',
};

/**
 * Le pas de progression n'existe que s'il y a une charge à incrémenter. La
 * validation le refuse au poids du corps ; le formulaire ne l'affiche donc pas.
 */
export function draftAllowsIncrement(draft: Pick<ExerciseDraft, 'loadType'>): boolean {
  return draft.loadType !== 'bodyweight';
}

/**
 * Convertit le brouillon en entrée de `createExercise`.
 *
 * Un champ vide ou illisible est **omis**, jamais deviné : la validation de la
 * base produit alors son message typé, seule source de vérité.
 */
export function exerciseDraftToInput(draft: ExerciseDraft): NewExerciseInput {
  const input: NewExerciseInput = {
    name: draft.name.trim(),
    loadType: draft.loadType,
    metric: draft.metric,
    perSide: draft.perSide,
  };

  if (draft.muscleGroup !== '') input.muscleGroup = draft.muscleGroup;

  if (draftAllowsIncrement(draft)) {
    const increment = parseNumberInput(draft.defaultIncrementKg);
    if (increment !== null) input.defaultIncrementKg = increment;
  }

  return input;
}

/** Vue réduite d'un exercice existant, pour proposer de le réutiliser. */
export type ConflictingExercise = Pick<Exercise, 'id' | 'name' | 'archivedAt'>;
