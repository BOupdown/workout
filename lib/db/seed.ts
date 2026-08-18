/**
 * Catalogue livré avec l'app, inséré une seule fois à la création de la base
 * (`on('populate')`).
 *
 * Sélection volontairement courte : de quoi logger une première série sans rien
 * créer à la main. Elle couvre surtout les **quatre `loadType` et les deux
 * `metric`**, pour que chaque branche de la validation ait un cas réel.
 */

import { newId, toNameKey } from './keys';
import type { Exercise } from './types';

type SeedExercise = Omit<Exercise, 'id' | 'nameKey' | 'isCustom' | 'createdAt'>;

const SEED: SeedExercise[] = [
  // --- Charge externe, en répétitions -------------------------------------
  { name: 'Squat', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 2.5 },
  { name: 'Soulevé de terre', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'hamstrings', defaultIncrementKg: 5 },
  { name: 'Développé couché', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 2.5 },
  { name: 'Développé militaire', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 2.5 },
  { name: 'Rowing barre', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Développé haltères', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 2 },
  { name: 'Rowing haltère unilatéral', loadType: 'external', metric: 'reps', perSide: true, muscleGroup: 'back', defaultIncrementKg: 2 },
  { name: 'Fentes marchées', loadType: 'external', metric: 'reps', perSide: true, muscleGroup: 'quads', defaultIncrementKg: 2 },
  { name: 'Presse à cuisses', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 5 },
  { name: 'Leg curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'hamstrings', defaultIncrementKg: 2.5 },
  { name: 'Tirage vertical', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Curl biceps haltères', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'biceps', defaultIncrementKg: 1 },
  { name: 'Extension triceps à la poulie', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 1 },
  { name: 'Élévations latérales', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 1 },
  { name: 'Mollets debout', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'calves', defaultIncrementKg: 2.5 },

  // --- Poids du corps + lest éventuel -------------------------------------
  // `weighted_bodyweight` et non `bodyweight` : la charge peut valoir 0, ce qui
  // laisse la progression continuer le jour où on met une ceinture.
  { name: 'Traction', loadType: 'weighted_bodyweight', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Dips', loadType: 'weighted_bodyweight', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 2.5 },

  // --- Assisté (la charge *retire* du poids) ------------------------------
  { name: 'Traction assistée', loadType: 'assisted', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 5 },

  // --- Poids du corps seul ------------------------------------------------
  { name: 'Pompes', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'chest' },
  { name: 'Crunch', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'core' },

  // --- Au temps -----------------------------------------------------------
  { name: 'Gainage planche', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'core' },
  { name: 'Suspension à la barre', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'forearms' },
  { name: 'Corde à sauter', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'cardio' },
];

/** Construit les lignes du catalogue, ids et `nameKey` dérivés. */
export function buildSeedExercises(now: number = Date.now()): Exercise[] {
  return SEED.map((exercise) => ({
    ...exercise,
    id: newId(),
    nameKey: toNameKey(exercise.name),
    isCustom: false,
    createdAt: now,
  }));
}
