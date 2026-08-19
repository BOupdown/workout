/**
 * Modèle de données de l'app.
 *
 * Hiérarchie :
 *   Exercise            le mouvement, réutilisable d'une séance à l'autre (catalogue)
 *   Session             une séance datée
 *   └─ SessionExercise  un exercice *dans* une séance (le « bloc »), porte l'ordre
 *      └─ SetEntry      une série exécutée : poids / reps / temps
 *
 * Toutes les charges sont en **kilogrammes**, stockage et affichage. L'app est
 * en kg, sans option d'unité : c'est un choix produit, pas une limitation
 * technique à lever plus tard.
 */

/** Identifiant opaque (UUID v4). Voir `newId()` dans `./db`. */
export type Id = string;

/** Instant absolu, en millisecondes depuis l'epoch (UTC). */
export type Timestamp = number;

/**
 * Date locale au format `YYYY-MM-DD`, telle que l'utilisateur la perçoit.
 * Doublonne volontairement `Session.startedAt` : c'est elle qui sert à regrouper
 * (« mes séances de mars »), sans dérive de fuseau horaire.
 */
export type LocalDate = string;

// ---------------------------------------------------------------------------
// Exercice
// ---------------------------------------------------------------------------

/**
 * D'où vient la charge — détermine comment lire `SetEntry.weightKg` et ce que
 * l'UI doit demander à l'utilisateur.
 */
export type LoadType =
  /** Barre, haltères, machine. `weightKg` = la charge soulevée. */
  | 'external'
  /** Poids du corps seul (pompes, tractions). `weightKg` absent. */
  | 'bodyweight'
  /** Poids du corps + lest (ceinture). `weightKg` = la charge *ajoutée*. */
  | 'weighted_bodyweight'
  /** Machine assistée / élastique. `weightKg` = l'assistance *retirée*. */
  | 'assisted';

/** Ce qu'on compte pour mesurer l'effort d'une série. */
export type EffortMetric =
  /** Répétitions → `SetEntry.reps` requis. */
  | 'reps'
  /** Durée (gainage, suspension) → `SetEntry.durationSec` requis. */
  | 'time';

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'fullbody'
  | 'cardio';

/**
 * Le mouvement lui-même. Entité de premier ordre : c'est la clé de voûte de la
 * progression dans le temps, donc jamais un simple nom recopié dans la série.
 */
export interface Exercise {
  id: Id;

  /** Libellé affiché, tel que saisi. Ex. : « Développé couché ». */
  name: string;
  /**
   * `name` normalisé (minuscules, accents et ponctuation retirés, espaces
   * compressés). Unique en base : empêche « Développé couché » et
   * « developpe couche » de devenir deux historiques distincts.
   */
  nameKey: string;

  loadType: LoadType;
  metric: EffortMetric;

  /**
   * `true` si les répétitions se comptent par côté (haltère unilatéral, fentes).
   * Lève l'ambiguïté « 10 reps = 10 ou 20 ? » au moment de comparer deux séances.
   */
  perSide: boolean;

  muscleGroup?: MuscleGroup;

  /** Pas des boutons +/- de l'UI, en kg (2.5 pour une barre, 1 pour une poulie). */
  defaultIncrementKg?: number;

  /** `false` = livré avec l'app, `true` = créé par l'utilisateur. */
  isCustom: boolean;

  /**
   * Masqué du sélecteur sans être supprimé — l'historique des séries doit rester
   * lisible. Champ *date* et non booléen : IndexedDB n'indexe pas les booléens.
   */
  archivedAt?: Timestamp;

  createdAt: Timestamp;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Séance
// ---------------------------------------------------------------------------

/** Une session datée. `endedAt` absent ⇒ séance en cours. */
export interface Session {
  id: Id;

  startedAt: Timestamp;
  /** Absent tant que la séance n'est pas clôturée. */
  endedAt?: Timestamp;

  /** Jour local de `startedAt`, dénormalisé pour le regroupement et le calendrier. */
  date: LocalDate;

  /** Ex. : « Push A ». Optionnel : en salle, on ne nomme pas sa séance. */
  title?: string;

  /**
   * Poids de corps du jour, en kg. Sans lui, aucune progression n'est mesurable
   * sur les exercices `bodyweight` / `weighted_bodyweight` / `assisted`.
   */
  bodyweightKg?: number;

  notes?: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Exercice dans une séance (le « bloc »)
// ---------------------------------------------------------------------------

/**
 * Rattache un exercice à une séance et porte son rang. Existe indépendamment des
 * séries : on ajoute l'exercice à la séance *puis* on saisit les séries, ce qui
 * correspond au geste réel (téléphone en main, entre deux séries).
 */
export interface SessionExercise {
  id: Id;
  sessionId: Id;
  exerciseId: Id;

  /** Rang dans la séance. Strictement croissant, pas nécessairement contigu. */
  order: number;

  /**
   * Blocs partageant le même numéro = supersérie. Non exploité pour l'instant,
   * la place est réservée pour ne pas avoir à migrer l'historique plus tard.
   */
  supersetGroup?: number;

  /** Notes du jour sur cet exercice (« banc trop haut », « douleur épaule »). */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Série
// ---------------------------------------------------------------------------

export type SetKind =
  /** Série comptée dans la progression et les records. */
  | 'work'
  /**
   * Échauffement : exclue des courbes et des PR. Sans cette distinction, les
   * montées en charge écrasent la lecture de la progression.
   */
  | 'warmup';

/**
 * Une exécution. Champs de mesure volontairement **plats et optionnels** plutôt
 * qu'union discriminée : c'est l'`Exercise` parent qui dit lesquels sont
 * pertinents, et les agrégats de progression restent triviaux à écrire.
 *
 * Invariants, appliqués par `./validation` et `./sets` :
 *   metric 'reps' → `reps` défini, `durationSec` absent
 *   metric 'time' → `durationSec` défini, `reps` absent
 *   loadType 'bodyweight' → `weightKg` absent ; sinon `weightKg` défini (≥ 0)
 */
export interface SetEntry {
  id: Id;

  /** Bloc auquel la série appartient. */
  sessionExerciseId: Id;

  /**
   * Dénormalisés depuis le bloc et la séance parents, uniquement pour permettre
   * l'index `[exerciseId+performedAt+order]` (historique d'un exercice sans
   * jointure). À réécrire si la date de la séance est modifiée.
   */
  sessionId: Id;
  exerciseId: Id;
  /** Copie de `Session.startedAt`. */
  performedAt: Timestamp;

  /**
   * Instant réel d'écriture de la série, dérivé à la création.
   *
   * Distinct de `performedAt`, qui est l'heure de *la séance* : c'est le seul
   * champ qui dit quand une série a effectivement été saisie. Il permet de
   * clôturer honnêtement une séance qu'on a oublié de terminer, en la ramenant
   * à sa dernière série plutôt qu'à « maintenant ».
   */
  loggedAt: Timestamp;

  /**
   * Rang dans le bloc. Strictement croissant, pas nécessairement contigu :
   * supprimer une série n'oblige pas à renuméroter les suivantes. L'affichage
   * « Série 1, 2, 3 » se fait sur l'index du tableau, pas sur ce champ.
   */
  order: number;

  kind: SetKind;

  /** Charge en kg. Sens déterminé par `Exercise.loadType`. */
  weightKg?: number;
  /** Répétitions. Par côté si `Exercise.perSide`. */
  reps?: number;
  /** Durée en secondes, pour les exercices au temps. */
  durationSec?: number;

  /** Difficulté ressentie, 1–10. */
  rpe?: number;
  /** Série menée jusqu'à l'échec musculaire. */
  isFailure?: boolean;

  notes?: string;
}

// ---------------------------------------------------------------------------
// Vues assemblées (jamais persistées)
// ---------------------------------------------------------------------------

/** Un bloc résolu avec son exercice et ses séries triées. */
export interface SessionExerciseWithSets extends SessionExercise {
  exercise: Exercise;
  sets: SetEntry[];
}

/** Une séance complète, prête à l'affichage. */
export interface SessionDetail extends Session {
  entries: SessionExerciseWithSets[];
}

/**
 * Ligne de la liste d'historique.
 *
 * Ne contient **que** ce qui s'obtient sans lire les séries : les champs de la
 * séance, les blocs (quelques lignes minuscules) et un comptage d'index. Le
 * volume total (Σ poids × reps) en est volontairement absent — c'est le seul
 * chiffre qui obligerait à charger chaque série de chaque séance.
 */
export interface SessionSummary {
  id: Id;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  date: LocalDate;
  title?: string;

  /** Durée en millisecondes. Absente tant que la séance n'est pas clôturée. */
  durationMs?: number;

  /** Nombre de blocs. Toujours égal à `exerciseNames.length`. */
  exerciseCount: number;

  /**
   * Nom de chaque bloc, dans l'ordre de la séance. Un exercice fait deux fois
   * y figure deux fois : c'est une projection fidèle, dédupliquer est un choix
   * d'affichage.
   */
  exerciseNames: string[];

  /**
   * Toutes séries confondues, échauffements compris. Ne compter que les séries
   * de travail obligerait à lire chaque enregistrement — `kind` n'est pas
   * indexé —, soit exactement ce que ce résumé évite.
   */
  setCount: number;
}
