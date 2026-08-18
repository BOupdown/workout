/**
 * Conversions entre valeurs numériques et texte affiché/saisi, en français.
 *
 * Le séparateur décimal français est la **virgule**. Un utilisateur qui tape
 * « 102,5 » doit être compris ; toute valeur affichée doit lui être rendue avec
 * une virgule. Le point reste accepté en entrée : les deux claviers existent.
 */

import type { Exercise, SetEntry } from './db/types';

/**
 * Décimal simple, éventuellement signé. Volontairement plus strict que
 * `Number()`, qui accepterait « 0x10 » ou « 1e5 » — ni l'un ni l'autre n'a de
 * sens dans un champ de charge.
 */
const DECIMAL_PATTERN = /^-?(\d+([.]\d*)?|[.]\d+)$/;

/**
 * Lit un champ de saisie. Retourne `null` si le champ est vide ou illisible :
 * l'appelant omet alors la mesure, et c'est la validation de la base qui
 * produit le message précis (« « Squat » attend une charge »). Pas de règle
 * dupliquée côté écran.
 */
export function parseNumberInput(value: string): number | null {
  const normalised = value.trim().replace(',', '.');
  if (normalised === '' || !DECIMAL_PATTERN.test(normalised)) return null;

  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rend un nombre avec la virgule décimale, sans zéros inutiles. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',');
}

export function formatWeight(kilograms: number): string {
  return `${formatNumber(kilograms)} kg`;
}

/** Durée en `m:ss`, ou `h:mm:ss` au-delà de l'heure. */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Temps écoulé depuis le début d'une séance, en langage de salle : on pense en
 * minutes sous l'heure, en heures au-delà. Les secondes n'intéressent personne.
 */
export function formatElapsed(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;

  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Série décomposée en deux parties, pour que l'affichage puisse donner à la
 * valeur mesurée le poids visuel qu'elle mérite et reléguer l'unité.
 *
 * C'est la seule source des règles de présentation d'une série : la forme
 * dépend de la nature de l'exercice, exactement comme la saisie.
 */
export interface SetDescription {
  /** La grandeur qui progresse, mise en avant. */
  primary: string;
  /** Ce qui la qualifie, en retrait. */
  secondary?: string;
}

export function describeSet(
  set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): SetDescription {
  if (exercise.metric === 'time') {
    return { primary: set.durationSec !== undefined ? formatDuration(set.durationSec) : '?' };
  }

  if (set.reps === undefined) return { primary: '?' };

  // Poids du corps, ou lest/assistance à zéro : afficher « 0 × 8 » n'apprendrait
  // rien, les répétitions sont toute l'information.
  if (exercise.loadType === 'bodyweight' || !set.weightKg) {
    return { primary: String(set.reps), secondary: 'reps' };
  }

  const sign = exercise.loadType === 'assisted' ? '-' : '';
  return { primary: `${sign}${formatNumber(set.weightKg)}`, secondary: `× ${set.reps}` };
}

/** Forme compacte sur une ligne, dérivée des mêmes règles. */
export function formatSetSummary(
  set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): string {
  const { primary, secondary } = describeSet(set, exercise);
  return secondary ? `${primary} ${secondary}` : primary;
}
