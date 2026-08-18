/** Primitives de dérivation des clés et des champs indexés du schéma. */

import type { LocalDate } from './types';

/**
 * Clé primaire : UUID v4, jamais un auto-increment — générable hors transaction
 * et sans collision lors d'un futur export / import entre appareils.
 *
 * `crypto.randomUUID()` n'existe **que** dans un contexte sécurisé. Tester l'app
 * depuis son téléphone en `http://192.168.x.x:3000` n'en est pas un, d'où le
 * repli : `crypto.getRandomValues()`, lui, est disponible partout.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Dérive `Exercise.nameKey` depuis `Exercise.name` : minuscules, accents retirés,
 * ponctuation neutralisée, espaces compressés.
 *
 * C'est ce qui fait que « Développé couché », « developpe couche » et
 * « Développé-couché » sont le *même* exercice, donc le même historique de
 * progression. Indexé en `&nameKey` (unique) dans le schéma.
 */
export function toNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques isolés par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Dates locales
// ---------------------------------------------------------------------------

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vérifie le format `YYYY-MM-DD` **et** l'existence réelle du jour. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;

  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);

  // Rejette les dates qui « débordent » (2026-02-30 deviendrait le 2 mars).
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** Jour local d'un instant, tel que l'utilisateur le perçoit. */
export function toLocalDate(timestamp: number): LocalDate {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Minuit local du jour donné. */
export function localMidnight(date: LocalDate): number {
  if (!isLocalDate(date)) throw new RangeError(`Date locale invalide : ${date}`);

  const [, year, month, day] = LOCAL_DATE_PATTERN.exec(date)!.map(Number);
  return new Date(year, month - 1, day).getTime();
}
