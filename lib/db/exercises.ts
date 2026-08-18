/**
 * Couche d'écriture du catalogue d'exercices.
 *
 * Même doctrine que `./sets` et `./sessions` :
 *   1. **Dériver plutôt que valider** — `id`, `nameKey`, `isCustom`, `createdAt`
 *      et `archivedAt` n'apparaissent dans aucun type d'entrée.
 *   2. **Valider ce qui reste** dans la transaction : unicité du nom normalisé
 *      et présence de séries déjà saisies, deux règles qui exigent une lecture
 *      et sont donc hors de portée des hooks Dexie synchrones.
 *
 * Pas de suppression définitive, volontairement : supprimer un exercice
 * orphelinerait chaque `SetEntry.exerciseId` de l'historique, et une cascade
 * détruirait des années de données depuis un écran de réglages. L'archivage
 * couvre le besoin réel (désencombrer le sélecteur) sans rien perdre.
 */

import { db } from './db';
import { newId, toNameKey } from './keys';
import { countSetsForExercise } from './sets';
import type {
  EffortMetric,
  Exercise,
  Id,
  LoadType,
  MuscleGroup,
  Timestamp,
} from './types';

// ---------------------------------------------------------------------------
// Erreurs métier
// ---------------------------------------------------------------------------

/**
 * Levée quand le nom normalisé est déjà pris.
 *
 * Porte l'exercice existant : l'UI peut proposer « « Développé couché » existe
 * déjà — l'utiliser ? » en un tap, sans second aller-retour. Le champ
 * `existing.archivedAt` lui dit s'il faut plutôt proposer un désarchivage.
 *
 * On ne retourne **jamais** silencieusement l'exercice existant à la place :
 * son `loadType` et sa `metric` ne sont pas ceux demandés, et l'appelant n'a
 * aucun moyen de s'en apercevoir.
 */
export class ExerciseNameConflictError extends Error {
  readonly existing: Exercise;

  constructor(existing: Exercise) {
    const state = existing.archivedAt !== undefined ? ' (archivé)' : '';
    super(`Un exercice nommé « ${existing.name} » existe déjà${state}.`);
    this.name = 'ExerciseNameConflictError';
    this.existing = existing;
  }
}

/**
 * Levée quand on tente de modifier la nature d'un exercice déjà utilisé.
 *
 * Volontairement sans échappatoire `force` : basculer un exercice de
 * `weighted_bodyweight` à `bodyweight` rendrait invalides toutes les séries
 * déjà saisies, et fausserait la progression en comparant des tractions
 * lestées à des tractions à vide. La bonne manœuvre est d'archiver l'ancien et
 * d'en créer un nouveau — un mouvement différent mérite une identité différente.
 */
export class ExerciseInUseError extends Error {
  readonly exerciseId: Id;
  readonly setCount: number;
  readonly lockedFields: readonly string[];

  constructor(exerciseId: Id, setCount: number, lockedFields: readonly string[]) {
    super(
      `Cet exercice compte ${setCount} série${setCount > 1 ? 's' : ''} : ` +
        `${lockedFields.join(', ')} ne ${lockedFields.length > 1 ? 'sont' : 'est'} ` +
        'plus modifiable. Archivez-le et créez-en un nouveau.',
    );
    this.name = 'ExerciseInUseError';
    this.exerciseId = exerciseId;
    this.setCount = setCount;
    this.lockedFields = lockedFields;
  }
}

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

export interface NewExerciseInput {
  name: string;
  loadType: LoadType;
  metric: EffortMetric;
  /** Répétitions comptées par côté. Par défaut `false`. */
  perSide?: boolean;
  muscleGroup?: MuscleGroup;
  defaultIncrementKg?: number;
  notes?: string;
}

/**
 * Champs modifiables. `archivedAt` en est absent — l'archivage passe par ses
 * propres fonctions ; `isCustom`, `id`, `nameKey` et `createdAt` aussi, ils
 * sont dérivés.
 *
 * Une clé présente valant `undefined` efface le champ, une clé absente le
 * laisse tel quel — même sémantique que `Table.update`.
 */
export type ExerciseUpdate = Partial<
  Pick<
    Exercise,
    'name' | 'loadType' | 'metric' | 'perSide' | 'muscleGroup' | 'defaultIncrementKg' | 'notes'
  >
>;

/**
 * Champs qui redéfinissent la **nature** de l'exercice, et donc le sens des
 * séries déjà enregistrées. Verrouillés dès qu'une série existe.
 *
 * `perSide` en fait partie bien qu'il ne casse aucune validation : passer de
 * `false` à `true` réécrit silencieusement le sens des répétitions passées
 * (« 10 » devient 10 par bras). Même dégât, moins visible.
 */
const NATURE_FIELDS = ['loadType', 'metric', 'perSide'] as const;

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

/** Retrouve un exercice par son nom, à la normalisation près. */
export async function findExerciseByName(name: string): Promise<Exercise | undefined> {
  return db.exercises.where('nameKey').equals(toNameKey(name)).first();
}

/**
 * Exercices proposables dans le sélecteur : tout sauf les archivés, par ordre
 * alphabétique.
 */
export async function listSelectableExercises(): Promise<Exercise[]> {
  return db.exercises
    .orderBy('name')
    .filter((exercise) => exercise.archivedAt === undefined)
    .toArray();
}

/**
 * Exercices archivés.
 *
 * `undefined` n'étant jamais indexé, l'index `archivedAt` ne contient *que* les
 * lignes archivées : la plage suffit, aucun filtre en mémoire.
 */
export async function listArchivedExercises(): Promise<Exercise[]> {
  return db.exercises.where('archivedAt').above(0).sortBy('name');
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

/**
 * Crée un exercice personnalisé.
 *
 * @throws {ExerciseNameConflictError} si le nom normalisé est déjà pris.
 */
export async function createExercise(input: NewExerciseInput): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const nameKey = toNameKey(input.name);

    // Le contrôle et l'insertion partagent la transaction : IndexedDB sérialise
    // les opérations d'un même store, aucune fenêtre entre les deux. L'index
    // `&nameKey` reste le garde-fou ultime, ce test n'existe que pour produire
    // une erreur exploitable plutôt qu'un `ConstraintError` opaque.
    const existing = await db.exercises.where('nameKey').equals(nameKey).first();
    if (existing) throw new ExerciseNameConflictError(existing);

    const exercise: Exercise = {
      id: newId(),
      name: input.name,
      nameKey,
      loadType: input.loadType,
      metric: input.metric,
      perSide: input.perSide ?? false,
      isCustom: true,
      createdAt: Date.now(),
      ...(input.muscleGroup !== undefined ? { muscleGroup: input.muscleGroup } : {}),
      ...(input.defaultIncrementKg !== undefined
        ? { defaultIncrementKg: input.defaultIncrementKg }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    await db.exercises.add(exercise);
    return exercise;
  });
}

/**
 * Modifie un exercice. `nameKey` est redérivé dès que `name` change.
 *
 * @throws {ExerciseNameConflictError} si le nouveau nom est déjà pris.
 * @throws {ExerciseInUseError} si la nature de l'exercice change alors que des
 *   séries existent déjà.
 */
export async function updateExercise(id: Id, patch: ExerciseUpdate): Promise<Exercise> {
  return db.transaction('rw', db.exercises, db.sets, async () => {
    const existing = await db.exercises.get(id);
    if (!existing) throw new Error(`Exercice introuvable : ${id}`);

    // Seuls les changements *effectifs* comptent : renvoyer la valeur courante
    // d'un champ verrouillé doit rester un no-op, pas une erreur.
    const changedNature = NATURE_FIELDS.filter(
      (field) => field in patch && patch[field] !== existing[field],
    );

    if (changedNature.length > 0) {
      const setCount = await countSetsForExercise(id);
      if (setCount > 0) throw new ExerciseInUseError(id, setCount, changedNature);
    }

    const changes: ExerciseUpdate & { nameKey?: string } = { ...patch };

    if (patch.name !== undefined) {
      const nameKey = toNameKey(patch.name);
      if (nameKey !== existing.nameKey) {
        const conflict = await db.exercises.where('nameKey').equals(nameKey).first();
        if (conflict) throw new ExerciseNameConflictError(conflict);
      }
      changes.nameKey = nameKey;
    }

    // Conséquence dérivée, pas une erreur à remonter : un exercice au poids du
    // corps n'a pas de champ de charge, donc pas de pas de progression. Exiger
    // de l'appelant qu'il pense à l'effacer lui-même ne produirait qu'un refus
    // incompréhensible — et la valeur effacée n'a, par définition, plus de sens.
    const nextLoadType = patch.loadType ?? existing.loadType;
    if (nextLoadType === 'bodyweight' && !('defaultIncrementKg' in changes)) {
      changes.defaultIncrementKg = undefined;
    }

    // Merge aligné sur `Table.update` : clé présente à `undefined` = suppression.
    const next = { ...existing } as Record<string, unknown>;
    for (const key of Object.keys(changes)) {
      const value = changes[key as keyof typeof changes];
      if (value === undefined) delete next[key];
      else next[key] = value;
    }

    await db.exercises.update(id, changes);
    return next as unknown as Exercise;
  });
}

/**
 * Archive un exercice : il quitte le sélecteur, **l'historique reste intact**.
 * Aucune `SetEntry` n'est touchée, la progression passée reste consultable.
 *
 * Idempotent : réarchiver un exercice déjà archivé le retourne inchangé.
 */
export async function archiveExercise(
  id: Id,
  archivedAt: Timestamp = Date.now(),
): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const exercise = await db.exercises.get(id);
    if (!exercise) throw new Error(`Exercice introuvable : ${id}`);
    if (exercise.archivedAt !== undefined) return exercise;

    await db.exercises.update(id, { archivedAt });
    return { ...exercise, archivedAt };
  });
}

/** Remet un exercice dans le sélecteur. Idempotent. */
export async function unarchiveExercise(id: Id): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const exercise = await db.exercises.get(id);
    if (!exercise) throw new Error(`Exercice introuvable : ${id}`);
    if (exercise.archivedAt === undefined) return exercise;

    // `undefined` supprime la propriété, la ligne sort donc de l'index
    // `archivedAt` — c'est ce qui la fait réapparaître dans le sélecteur.
    await db.exercises.update(id, { archivedAt: undefined });

    const unarchived = { ...exercise };
    delete unarchived.archivedAt;
    return unarchived;
  });
}
