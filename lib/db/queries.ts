/**
 * Lectures assemblées, transverses aux entités.
 *
 * Deux projections, aucune écriture :
 *   getSessionDetail()      une séance complète, pour l'écran de séance
 *   listSessionSummaries()  la liste d'historique, paginée et légère
 *
 * Règle commune : **aucune de ces lectures ne filtre sur `archivedAt`**.
 * L'archivage ne concerne que la sélection d'un exercice ; filtrer ici ferait
 * disparaître un bloc d'une séance passée alors que ses séries existent
 * toujours. Les exercices sont donc résolus par `bulkGet` sur les ids, jamais
 * via une liste filtrée.
 */

import { db } from './db';
import { listSessionExercises } from './sessions';
import type {
  Exercise,
  Id,
  SessionDetail,
  SessionExercise,
  SessionExerciseWithSets,
  SessionSummary,
  SetEntry,
  Timestamp,
} from './types';

/**
 * Un bloc désigne un exercice qui n'existe plus. Aucun chemin d'écriture ne
 * peut produire cet état — il n'y a pas de suppression d'exercice —, donc on
 * échoue bruyamment plutôt que d'escamoter silencieusement un exercice de
 * l'historique.
 */
function missingExercise(block: SessionExercise): Error {
  return new Error(
    `Exercice ${block.exerciseId} introuvable, référencé par le bloc ${block.id}. ` +
      'Base incohérente.',
  );
}

/** Index des exercices désignés par une liste de blocs, en une seule requête. */
async function loadExercisesFor(blocks: SessionExercise[]): Promise<Map<Id, Exercise>> {
  const ids = [...new Set(blocks.map((block) => block.exerciseId))];
  const exercises = await db.exercises.bulkGet(ids);

  const byId = new Map<Id, Exercise>();
  for (const exercise of exercises) {
    if (exercise) byId.set(exercise.id, exercise);
  }
  return byId;
}

/**
 * Une séance, ses blocs, leurs exercices et leurs séries.
 *
 * Quatre requêtes indexées, quel que soit le nombre de blocs : la séance, ses
 * blocs, un `bulkGet` des exercices dédupliqués, et **une seule** plage sur les
 * séries de la séance — pas de requête par bloc. Le regroupement se fait en
 * mémoire.
 *
 * Le tout dans une transaction en lecture, pour que blocs et séries proviennent
 * du même instantané : sans elle, une série écrite entre les deux requêtes
 * donnerait une vue incohérente.
 */
export async function getSessionDetail(sessionId: Id): Promise<SessionDetail | undefined> {
  return db.transaction(
    'r',
    db.sessions,
    db.sessionExercises,
    db.sets,
    db.exercises,
    async () => {
      const session = await db.sessions.get(sessionId);
      if (!session) return undefined;

      // Déjà triés par l'index `[sessionId+order]`.
      const blocks = await listSessionExercises(sessionId);

      const [exerciseById, sets] = await Promise.all([
        loadExercisesFor(blocks),
        // Tri global par `order` : chaque groupe est donc constitué dans le bon
        // ordre au fil du remplissage, sans re-trier bloc par bloc.
        db.sets.where('sessionId').equals(sessionId).sortBy('order'),
      ]);

      const setsByBlock = new Map<Id, SetEntry[]>();
      for (const set of sets) {
        const bucket = setsByBlock.get(set.sessionExerciseId);
        if (bucket) bucket.push(set);
        else setsByBlock.set(set.sessionExerciseId, [set]);
      }

      const entries: SessionExerciseWithSets[] = blocks.map((block) => {
        const exercise = exerciseById.get(block.exerciseId);
        if (!exercise) throw missingExercise(block);

        return {
          ...block,
          exercise,
          sets: setsByBlock.get(block.id) ?? [],
        };
      });

      return { ...session, entries };
    },
  );
}

export interface SessionHistoryPage {
  /** Nombre de séances à retourner. */
  limit?: number;
  /**
   * Curseur : ne retourne que les séances **strictement antérieures** à cet
   * instant. Passer le `startedAt` de la dernière ligne affichée enchaîne la
   * page suivante sans recouvrement.
   */
  before?: Timestamp;
}

/**
 * Liste d'historique, de la plus récente à la plus ancienne.
 *
 * Le coût d'une page ne dépend **pas** du nombre de séries des séances : le
 * comptage passe par `count()` sur une plage d'index, qui dénombre les entrées
 * d'index sans charger les enregistrements. Une séance de 40 séries coûte donc
 * autant qu'une séance de 5.
 *
 * Le volume total est délibérément absent de `SessionSummary` : c'est le seul
 * chiffre qui casserait cette propriété. S'il devient nécessaire, il faudra le
 * calculer pour la seule page affichée — et surtout pas dénormaliser un
 * agrégat sur `Session`, qui dériverait à chaque écriture de série.
 */
export async function listSessionSummaries(
  options: SessionHistoryPage = {},
): Promise<SessionSummary[]> {
  const { limit = 20, before } = options;

  return db.transaction(
    'r',
    db.sessions,
    db.sessionExercises,
    db.sets,
    db.exercises,
    async () => {
      // `below(Infinity)` unifie les deux cas : `startedAt` est toujours un
      // nombre fini, la borne par défaut n'exclut donc rien.
      const sessions = await db.sessions
        .where('startedAt')
        .below(before ?? Infinity)
        .reverse()
        .limit(limit)
        .toArray();

      if (sessions.length === 0) return [];

      const blocksBySession = new Map<Id, SessionExercise[]>();
      await Promise.all(
        sessions.map(async (session) => {
          blocksBySession.set(session.id, await listSessionExercises(session.id));
        }),
      );

      const allBlocks = [...blocksBySession.values()].flat();
      const [exerciseById, setCounts] = await Promise.all([
        loadExercisesFor(allBlocks),
        // Un `count()` indexé par séance — aucun enregistrement de série lu.
        Promise.all(
          sessions.map((session) => db.sets.where('sessionId').equals(session.id).count()),
        ),
      ]);

      return sessions.map((session, index) => {
        const blocks = blocksBySession.get(session.id) ?? [];

        const exerciseNames = blocks.map((block) => {
          const exercise = exerciseById.get(block.exerciseId);
          if (!exercise) throw missingExercise(block);
          return exercise.name;
        });

        return {
          id: session.id,
          startedAt: session.startedAt,
          date: session.date,
          exerciseCount: blocks.length,
          exerciseNames,
          setCount: setCounts[index],
          ...(session.title !== undefined ? { title: session.title } : {}),
          ...(session.endedAt !== undefined
            ? { endedAt: session.endedAt, durationMs: session.endedAt - session.startedAt }
            : {}),
        };
      });
    },
  );
}
