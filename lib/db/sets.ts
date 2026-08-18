/**
 * Couche d'écriture des séries — le seul point d'entrée pour créer ou modifier
 * une `SetEntry`.
 *
 * Deux stratégies complémentaires pour tenir les invariants :
 *
 *   1. **Dériver plutôt que valider.** `sessionId`, `exerciseId`, `performedAt`
 *      et `order` n'apparaissent dans aucun type d'entrée : ils sont recalculés
 *      depuis le bloc parent. Un appelant ne peut donc pas les désynchroniser,
 *      il n'y a rien à vérifier.
 *   2. **Valider ce qui reste**, dans la transaction, contre l'`Exercise`
 *      parent — ce que les hooks Dexie, synchrones, ne peuvent pas faire.
 */

import { db } from './db';
import { newId } from './keys';
import type { Id, SetEntry, SetKind } from './types';
import { assertValidSet } from './validation';

/**
 * Bornes des composantes numériques d'une clé composée.
 *
 * On n'utilise **pas** `Dexie.maxKey` : c'est une unique instance de tableau
 * (`[[]]`), or l'algorithme « convert a value to a key » de la spec IndexedDB
 * partage son ensemble `seen` entre les éléments frères d'une clé composée et
 * rejette toute valeur déjà rencontrée. La détection de cycle ne distingue pas
 * un vrai cycle d'un doublon d'instance : `[id, maxKey, maxKey]` lève donc un
 * `DataError`. `performedAt` et `order` étant toujours des nombres, ±Infinity
 * est une borne exacte et sans piège.
 */
const MIN_NUMBER_KEY = -Infinity;
const MAX_NUMBER_KEY = Infinity;

/**
 * Ce qu'un appelant fournit pour créer une série. Tout le reste est dérivé —
 * c'est la moitié « rendue impossible » des invariants.
 */
export interface NewSetInput {
  sessionExerciseId: Id;
  /** Par défaut `'work'`. */
  kind?: SetKind;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  rpe?: number;
  isFailure?: boolean;
  notes?: string;
}

/**
 * Champs modifiables après coup. Les champs dénormalisés en sont volontairement
 * absents : les retirer du type est plus solide que de les refuser à l'exécution.
 *
 * Une clé présente valant `undefined` **efface** le champ (même sémantique que
 * `Table.update` de Dexie) ; une clé absente le laisse tel quel.
 */
export type SetPatch = Partial<
  Pick<SetEntry, 'kind' | 'weightKg' | 'reps' | 'durationSec' | 'rpe' | 'isFailure' | 'notes'>
>;

/** Retire les clés à `undefined` pour ne pas les matérialiser en base. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * Crée une série dans un bloc existant.
 *
 * @throws {SetValidationError} si les mesures ne correspondent pas à l'exercice
 *   (charge sur un exercice au poids du corps, reps sur un exercice au temps…).
 * @throws {Error} si le bloc, la séance ou l'exercice sont introuvables.
 */
export async function createSet(input: NewSetInput): Promise<SetEntry> {
  return db.transaction(
    'rw',
    db.sets,
    db.sessionExercises,
    db.sessions,
    db.exercises,
    async () => {
      const block = await db.sessionExercises.get(input.sessionExerciseId);
      if (!block) {
        throw new Error(`Bloc d'exercice introuvable : ${input.sessionExerciseId}`);
      }

      const [session, exercise] = await Promise.all([
        db.sessions.get(block.sessionId),
        db.exercises.get(block.exerciseId),
      ]);
      if (!session) throw new Error(`Séance introuvable : ${block.sessionId}`);
      if (!exercise) throw new Error(`Exercice introuvable : ${block.exerciseId}`);

      // `order` strictement croissant, pas nécessairement contigu : supprimer
      // une série ne doit pas obliger à renuméroter les suivantes. L'affichage
      // « Série 1, 2, 3 » se fait sur l'index du tableau, pas sur ce champ.
      const last = await db.sets
        .where('[sessionExerciseId+order]')
        .between([block.id, MIN_NUMBER_KEY], [block.id, MAX_NUMBER_KEY])
        .reverse()
        .first();

      const entry: SetEntry = withoutUndefined({
        id: newId(),
        sessionExerciseId: block.id,

        // Dénormalisations, dérivées des parents — jamais fournies par l'appelant.
        sessionId: block.sessionId,
        exerciseId: block.exerciseId,
        performedAt: session.startedAt,
        loggedAt: Date.now(),

        order: last ? last.order + 1 : 0,
        kind: input.kind ?? 'work',

        weightKg: input.weightKg,
        reps: input.reps,
        durationSec: input.durationSec,
        rpe: input.rpe,
        isFailure: input.isFailure,
        notes: input.notes,
      });

      assertValidSet(entry, exercise);
      await db.sets.add(entry);
      return entry;
    },
  );
}

/**
 * Modifie une série existante. La série résultante est validée **avant**
 * écriture : une correction de frappe ne peut pas rendre l'historique incohérent.
 *
 * @throws {SetValidationError} si le résultat du patch est invalide.
 */
export async function updateSet(id: Id, patch: SetPatch): Promise<SetEntry> {
  return db.transaction('rw', db.sets, db.exercises, async () => {
    const existing = await db.sets.get(id);
    if (!existing) throw new Error(`Série introuvable : ${id}`);

    const exercise = await db.exercises.get(existing.exerciseId);
    if (!exercise) throw new Error(`Exercice introuvable : ${existing.exerciseId}`);

    // Merge aligné sur la sémantique de `Table.update` : clé présente à
    // `undefined` = suppression du champ, clé absente = inchangé.
    const next = { ...existing } as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      const value = patch[key as keyof SetPatch];
      if (value === undefined) delete next[key];
      else next[key] = value;
    }

    const merged = next as unknown as SetEntry;
    assertValidSet(merged, exercise);

    await db.sets.update(id, patch);
    return merged;
  });
}

/**
 * Les `order` restant strictement croissants et non contigus, une suppression
 * n'a rien à renuméroter.
 */
export async function deleteSet(id: Id): Promise<void> {
  await db.sets.delete(id);
}

/**
 * Nombre de séries jamais enregistrées pour un exercice, échauffements compris.
 *
 * Il n'existe **pas** d'index sur `exerciseId` seul : le composé
 * `[exerciseId+performedAt+order]` le couvre déjà, une plage sur son premier
 * élément suffit. Un index de plus serait un index de plus à maintenir à chaque
 * écriture de série.
 */
export async function countSetsForExercise(exerciseId: Id): Promise<number> {
  return db.sets
    .where('[exerciseId+performedAt+order]')
    .between(
      [exerciseId, MIN_NUMBER_KEY, MIN_NUMBER_KEY],
      [exerciseId, MAX_NUMBER_KEY, MAX_NUMBER_KEY],
    )
    .count();
}

/**
 * « Montre-moi mes N dernières séries de squat. »
 *
 * Sert autant de requête utile que de justification de l'index
 * `[exerciseId+performedAt+order]` : aucune jointure avec `sessions`, et le tri
 * intra-séance reste exact grâce à `order` en troisième position.
 */
export async function recentSetsForExercise(
  exerciseId: Id,
  limit = 5,
  options: { includeWarmups?: boolean } = {},
): Promise<SetEntry[]> {
  const collection = db.sets
    .where('[exerciseId+performedAt+order]')
    .between(
      [exerciseId, MIN_NUMBER_KEY, MIN_NUMBER_KEY],
      [exerciseId, MAX_NUMBER_KEY, MAX_NUMBER_KEY],
    )
    .reverse();

  // Filtrer `kind` en mémoire plutôt que via un index dédié : la queue parcourue
  // est minuscule, et c'est un index de moins à maintenir à chaque écriture.
  if (options.includeWarmups) return collection.limit(limit).toArray();

  return collection
    .filter((set) => set.kind === 'work')
    .limit(limit)
    .toArray();
}
