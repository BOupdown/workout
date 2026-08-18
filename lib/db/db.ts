import Dexie, { type Table } from 'dexie';
import { buildSeedExercises } from './seed';
import type {
  Exercise,
  Session,
  SessionExercise,
  SetEntry,
} from './types';
import {
  assertExerciseShape,
  assertSessionExerciseShape,
  assertSessionShape,
  assertSetShape,
} from './validation';

/**
 * Base IndexedDB de l'app.
 *
 * ⚠️ Module **client uniquement** : à n'importer que depuis des composants
 * `'use client'`. `indexedDB` n'existe pas côté serveur.
 *
 * Rappels IndexedDB qui expliquent la forme du schéma ci-dessous :
 *   • un booléen n'est pas une clé valide → `archivedAt?: number`, `kind: string`
 *   • `undefined` n'est jamais indexé → une ligne dont le champ indexé est absent
 *     est *invisible* dans cet index (d'où l'absence d'index sur `endedAt`)
 *   • un index composé ne se requête que par préfixe, dans l'ordre déclaré
 */
export class WorkoutDB extends Dexie {
  // `Table` et non `EntityTable` : les `id` sont fournis par `newId()`, pas
  // auto-générés — `add()` doit donc les exiger.
  exercises!: Table<Exercise, string>;
  sessions!: Table<Session, string>;
  sessionExercises!: Table<SessionExercise, string>;
  sets!: Table<SetEntry, string>;

  constructor() {
    super('workout');

    this.version(1).stores({
      // `&nameKey` : unicité du nom normalisé, garde-fou contre les doublons
      // d'exercice qui fragmenteraient l'historique.
      // `archivedAt` : seules les lignes archivées y figurent (undefined non indexé),
      // ce qui en fait directement la liste des archives.
      exercises: 'id, &nameKey, name, muscleGroup, archivedAt',

      // `startedAt` : liste antéchronologique + reprise de la séance en cours
      // (dernière ligne, puis test de `endedAt` en mémoire).
      // `date` : regroupement par jour / calendrier, sans dérive de fuseau.
      sessions: 'id, startedAt, date',

      // `[sessionId+order]` : rendu d'une séance, blocs déjà triés.
      // `exerciseId` : « dans quelles séances ai-je fait cet exercice ? ».
      sessionExercises: 'id, sessionId, exerciseId, [sessionId+order]',

      // `[sessionExerciseId+order]` : les séries d'un bloc, déjà triées.
      //
      // `[exerciseId+performedAt+order]` : l'index qui porte toute la feature de
      // progression. « Mes 5 dernières séries de squat » =
      //
      //   db.sets
      //     .where('[exerciseId+performedAt+order]')
      //     .between([squatId, -Infinity, -Infinity], [squatId, Infinity, Infinity])
      //     .reverse()
      //     .limit(5)
      //     .toArray()
      //
      // (bornes numériques explicites et non `Dexie.maxKey` : voir le
      // commentaire de `MIN_NUMBER_KEY` dans `./sets`)
      //
      // → O(log n) + 5 lectures, aucune jointure avec `sessions`, et le tri
      // intra-séance est exact grâce à `order` en 3ᵉ position. Filtrer `kind`
      // ('work' vs 'warmup') se fait en mémoire sur cette queue minuscule plutôt
      // qu'avec un index supplémentaire à maintenir à chaque écriture.
      //
      // `sessionId` : suppression en cascade d'une séance.
      sets:
        'id, sessionId, sessionExerciseId, [sessionExerciseId+order], [exerciseId+performedAt+order]',
    });

    // Catalogue de départ, une seule fois à la création de la base.
    this.on('populate', (tx) => {
      tx.table<Exercise, string>('exercises').bulkAdd(buildSeedExercises());
    });

    // Dernier rempart sur les invariants structurels. Les hooks Dexie sont
    // **synchrones** : ils ne peuvent donc vérifier que ce qui ne demande
    // aucune lecture (types, bornes, énumérations, cohérence entre deux champs
    // d'une même ligne). Les invariants qui dépendent d'une autre entité —
    // charge attendue ou non selon l'`Exercise`, exercice archivé — sont
    // traités dans `./sets` et `./sessions`, qui peuvent lire dans la
    // transaction.
    //
    // Lever ici abandonne la transaction : rien n'est écrit à moitié.
    installShapeGuard(this.exercises, assertExerciseShape);
    installShapeGuard(this.sets, assertSetShape);
    installShapeGuard(this.sessions, assertSessionShape);
    installShapeGuard(this.sessionExercises, assertSessionExerciseShape);
  }
}

/**
 * Branche un validateur structurel sur les écritures d'une table.
 *
 * Le hook `updating` reçoit des chemins de propriétés ; le modèle étant
 * entièrement plat, un merge de surface reconstitue fidèlement la ligne
 * résultante (une clé présente à `undefined` vaut suppression, exactement comme
 * pour `Table.update`).
 */
function installShapeGuard<T>(table: Table<T, string>, assertShape: (value: unknown) => void) {
  table.hook('creating', (_primaryKey, entity) => {
    assertShape(entity);
  });

  table.hook('updating', (modifications, _primaryKey, entity) => {
    assertShape({ ...entity, ...modifications });
  });
}

export const db = new WorkoutDB();

export { newId, toNameKey } from './keys';
