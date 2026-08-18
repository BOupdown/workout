/**
 * Couche d'écriture des séances et des blocs (`SessionExercise`).
 *
 * Même doctrine que `./sets` :
 *   1. **Dériver plutôt que valider** — `id`, `date`, `order` et `createdAt`
 *      n'apparaissent dans aucun type d'entrée.
 *   2. **Valider ce qui reste**, dans la transaction, contre les entités
 *      parentes, ce que les hooks Dexie synchrones ne peuvent pas faire.
 */

import { db } from './db';
import { localMidnight, newId, toLocalDate } from './keys';
import type { Id, LocalDate, Session, SessionExercise, Timestamp } from './types';
import { assertExerciseSelectable } from './validation';

/** Voir `MIN_NUMBER_KEY` dans `./sets` — mêmes bornes, même raison. */
const MIN_NUMBER_KEY = -Infinity;
const MAX_NUMBER_KEY = Infinity;

// ---------------------------------------------------------------------------
// Erreurs métier
// ---------------------------------------------------------------------------

/**
 * Levée quand on retire un bloc qui contient déjà des séries sans passer
 * `force`. Porte `setCount` pour que l'UI puisse demander une confirmation
 * chiffrée (« Retirer Squat et ses 4 séries ? ») plutôt qu'un vague avertissement.
 */
export class SessionExerciseNotEmptyError extends Error {
  readonly sessionExerciseId: Id;
  readonly setCount: number;

  constructor(sessionExerciseId: Id, setCount: number) {
    super(
      `Cet exercice contient ${setCount} série${setCount > 1 ? 's' : ''} : ` +
        'passez `force: true` pour le retirer avec ses séries.',
    );
    this.name = 'SessionExerciseNotEmptyError';
    this.sessionExerciseId = sessionExerciseId;
    this.setCount = setCount;
  }
}

// ---------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------

export interface NewSessionInput {
  title?: string;
  bodyweightKg?: number;
  notes?: string;
  /** Pour saisir une séance passée. Par défaut, maintenant. */
  startedAt?: Timestamp;
}

export interface StartSessionResult {
  session: Session;
  /**
   * Séance restée ouverte et clôturée automatiquement pour libérer la place.
   * À remonter à l'utilisateur : il n'a rien demandé.
   */
  autoClosed?: Session;
}

/**
 * Séance en cours, s'il y en a une. Ne modifie **rien** : rouvrir l'app vingt
 * minutes plus tard doit reprendre la séance, pas la clôturer.
 *
 * Parcours à rebours depuis la plus récente ; sous l'invariant « au plus une
 * séance ouverte » tenu par `startSession`, la réponse tombe au premier essai.
 */
export async function getActiveSession(): Promise<Session | undefined> {
  return db.sessions
    .orderBy('startedAt')
    .reverse()
    .filter((session) => session.endedAt === undefined)
    .first();
}

/**
 * Clôture une séance à l'instant de sa **dernière série saisie**, et non à
 * « maintenant » : sans ça, une séance oubliée depuis une semaine afficherait
 * une durée de sept jours. Sans aucune série, on retombe sur `startedAt`.
 */
async function closeAtLastLoggedSet(session: Session): Promise<Session> {
  const sets = await db.sets.where('sessionId').equals(session.id).toArray();
  const lastLoggedAt = sets.reduce((latest, set) => Math.max(latest, set.loggedAt), 0);

  const endedAt = Math.max(session.startedAt, lastLoggedAt);
  await db.sessions.update(session.id, { endedAt });
  return { ...session, endedAt };
}

/**
 * Ouvre une séance.
 *
 * Si une séance précédente est restée ouverte — cas courant : on range son
 * téléphone sans taper « Terminer » —, elle est **clôturée automatiquement**
 * plutôt que de bloquer l'utilisateur en salle avec une erreur. La séance
 * ainsi fermée est retournée dans `autoClosed` pour que l'UI le signale.
 */
export async function startSession(input: NewSessionInput = {}): Promise<StartSessionResult> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    // Balayage complet plutôt que lecture de la seule dernière séance : c'est
    // ce qui garantit l'invariant « au plus une ouverte » même si une ligne
    // aberrante s'est glissée en base. La table reste petite (une ligne par
    // séance) ; si elle grossissait, un champ `status` indexé prendrait le relais.
    const stillOpen = await db.sessions
      .filter((session) => session.endedAt === undefined)
      .toArray();

    let autoClosed: Session | undefined;
    for (const session of stillOpen) {
      autoClosed = await closeAtLastLoggedSet(session);
    }

    const startedAt = input.startedAt ?? Date.now();
    const session: Session = {
      id: newId(),
      startedAt,
      date: toLocalDate(startedAt),
      createdAt: Date.now(),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.bodyweightKg !== undefined ? { bodyweightKg: input.bodyweightKg } : {}),
    };

    await db.sessions.add(session);
    return autoClosed ? { session, autoClosed } : { session };
  });
}

/**
 * Clôture une séance. Idempotent : re-clôturer une séance déjà terminée la
 * retourne inchangée, un double appui sur « Terminer » ne doit pas produire
 * d'erreur.
 */
export async function endSession(id: Id, endedAt: Timestamp = Date.now()): Promise<Session> {
  return db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error(`Séance introuvable : ${id}`);
    if (session.endedAt !== undefined) return session;

    // `endedAt >= startedAt` est vérifié par le hook structurel.
    await db.sessions.update(id, { endedAt });
    return { ...session, endedAt };
  });
}

/**
 * Change le jour d'une séance et **propage `performedAt` sur toutes ses
 * séries** — la dénormalisation qui rend l'historique par exercice rapide est
 * aussi celle qui peut se désynchroniser. C'est le seul chemin autorisé pour
 * modifier la date d'une séance.
 *
 * L'heure de la journée est conservée et `endedAt` est décalé d'autant : le cas
 * réel est « j'ai loggé ça hier, pas aujourd'hui », pas « remets ça à minuit ».
 */
export async function updateSessionDate(id: Id, date: LocalDate): Promise<Session> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error(`Séance introuvable : ${id}`);

    // Heure du jour reprise de `startedAt` lui-même, et non de `session.date` :
    // reste juste même si les deux ont divergé après un changement de fuseau.
    const previous = new Date(session.startedAt);
    const target = new Date(localMidnight(date));
    target.setHours(
      previous.getHours(),
      previous.getMinutes(),
      previous.getSeconds(),
      previous.getMilliseconds(),
    );

    const startedAt = target.getTime();
    const shift = startedAt - session.startedAt;
    const endedAt = session.endedAt !== undefined ? session.endedAt + shift : undefined;

    await db.sessions.update(id, {
      startedAt,
      date,
      ...(endedAt !== undefined ? { endedAt } : {}),
    });

    await db.sets.where('sessionId').equals(id).modify({ performedAt: startedAt });

    return { ...session, startedAt, date, ...(endedAt !== undefined ? { endedAt } : {}) };
  });
}

/** Supprime une séance, ses blocs et toutes ses séries en une seule transaction. */
export async function deleteSession(id: Id): Promise<void> {
  await db.transaction('rw', db.sessions, db.sessionExercises, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete();
    await db.sessionExercises.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Blocs (exercice dans une séance)
// ---------------------------------------------------------------------------

/**
 * Ajoute un exercice à une séance. Le même exercice peut y figurer deux fois
 * (début et fin de séance, c'est un schéma d'entraînement courant).
 *
 * Autorisé sur une séance déjà clôturée : corriger un oubli la veille au soir
 * est un usage légitime.
 */
export async function addExerciseToSession(
  sessionId: Id,
  exerciseId: Id,
  options: { notes?: string } = {},
): Promise<SessionExercise> {
  return db.transaction('rw', db.sessionExercises, db.sessions, db.exercises, async () => {
    const [session, exercise] = await Promise.all([
      db.sessions.get(sessionId),
      db.exercises.get(exerciseId),
    ]);
    if (!session) throw new Error(`Séance introuvable : ${sessionId}`);
    if (!exercise) throw new Error(`Exercice introuvable : ${exerciseId}`);

    assertExerciseSelectable(exercise);

    const last = await db.sessionExercises
      .where('[sessionId+order]')
      .between([sessionId, MIN_NUMBER_KEY], [sessionId, MAX_NUMBER_KEY])
      .reverse()
      .first();

    const block: SessionExercise = {
      id: newId(),
      sessionId,
      exerciseId,
      order: last ? last.order + 1 : 0,
      ...(options.notes !== undefined ? { notes: options.notes } : {}),
    };

    await db.sessionExercises.add(block);
    return block;
  });
}

/** Blocs d'une séance, déjà triés par l'index `[sessionId+order]`. */
export async function listSessionExercises(sessionId: Id): Promise<SessionExercise[]> {
  return db.sessionExercises
    .where('[sessionId+order]')
    .between([sessionId, MIN_NUMBER_KEY], [sessionId, MAX_NUMBER_KEY])
    .toArray();
}

/**
 * Retire un exercice d'une séance.
 *
 * Un bloc vide disparaît sans cérémonie — c'est une erreur de saisie. Un bloc
 * qui contient des séries exige `force: true` : une faute de frappe à une main
 * entre deux séries ne doit pas effacer quatre séries de squat.
 *
 * @throws {SessionExerciseNotEmptyError} si des séries existent et `force` est absent.
 */
export async function removeExerciseFromSession(
  sessionExerciseId: Id,
  options: { force?: boolean } = {},
): Promise<{ deletedSets: number }> {
  return db.transaction('rw', db.sessionExercises, db.sets, async () => {
    const block = await db.sessionExercises.get(sessionExerciseId);
    if (!block) throw new Error(`Bloc d'exercice introuvable : ${sessionExerciseId}`);

    const setCount = await db.sets
      .where('sessionExerciseId')
      .equals(sessionExerciseId)
      .count();

    if (setCount > 0 && !options.force) {
      throw new SessionExerciseNotEmptyError(sessionExerciseId, setCount);
    }

    await db.sets.where('sessionExerciseId').equals(sessionExerciseId).delete();
    await db.sessionExercises.delete(sessionExerciseId);

    return { deletedSets: setCount };
  });
}

/**
 * Réordonne les exercices d'une séance.
 *
 * `orderedIds` doit décrire **exactement** les blocs de la séance : un ordre
 * partiel laisserait des rangs incohérents. Contrairement aux séries, on
 * renumérote ici en 0…n-1 — c'est un geste explicite, et N vaut une poignée.
 */
export async function reorderSessionExercises(
  sessionId: Id,
  orderedIds: Id[],
): Promise<SessionExercise[]> {
  return db.transaction('rw', db.sessionExercises, async () => {
    const blocks = await listSessionExercises(sessionId);
    const known = new Set(blocks.map((block) => block.id));

    const isExactCover =
      orderedIds.length === blocks.length &&
      new Set(orderedIds).size === orderedIds.length &&
      orderedIds.every((id) => known.has(id));

    if (!isExactCover) {
      throw new Error(
        `Réordonnancement invalide : attendu exactement les ${blocks.length} exercice(s) ` +
          `de la séance ${sessionId}, reçu ${orderedIds.length} identifiant(s).`,
      );
    }

    await Promise.all(
      orderedIds.map((id, order) => db.sessionExercises.update(id, { order })),
    );

    return listSessionExercises(sessionId);
  });
}
