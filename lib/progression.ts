/**
 * Construction de la progression d'un exercice : de la liste brute des séries
 * au tracé de la courbe.
 *
 * Tout est pur et sans dépendance au DOM — c'est ce qui rend ces règles
 * testables sans rendu.
 *
 * Décision structurante : **une seule grandeur en ordonnée**. Poids et
 * répétitions n'ont ni la même échelle ni la même unité ; les superposer sur
 * deux axes inventerait une corrélation absente des données. La grandeur
 * retenue est celle qui progresse pour cet exercice, exactement selon les mêmes
 * règles que la saisie ; les répétitions accompagnent la valeur en annotation.
 */

import type { Exercise, Id, SetEntry, Timestamp } from './db/types';
import { setFieldRequirements } from './db/validation';

export type ProgressionMetric = 'weightKg' | 'reps' | 'durationSec';

/** Grandeur suivie pour cet exercice, dérivée de sa nature. */
export function progressionMetric(
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): ProgressionMetric {
  const requirements = setFieldRequirements(exercise);
  if (requirements.durationSec === 'required') return 'durationSec';
  if (requirements.weightKg === 'required') return 'weightKg';
  return 'reps';
}

/** La meilleure série de travail d'une séance, pour la grandeur suivie. */
export interface SessionPoint {
  sessionId: Id;
  performedAt: Timestamp;
  value: number;
  /** Répétitions de cette série, quand la valeur est une charge. */
  reps?: number;
  /** Nombre de séries de travail de la séance. */
  setCount: number;
}

/**
 * Réduit les séries à un point par séance : la meilleure série de travail.
 *
 * Les échauffements sont exclus — les inclure ferait plonger la courbe à chaque
 * séance où la montée en charge a été loggée.
 */
export function buildProgression(
  sets: SetEntry[],
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): SessionPoint[] {
  const metric = progressionMetric(exercise);
  const bySession = new Map<Id, SessionPoint>();

  for (const set of sets) {
    if (set.kind !== 'work') continue;

    const value = set[metric];
    if (value === undefined) continue;

    const existing = bySession.get(set.sessionId);
    if (!existing) {
      bySession.set(set.sessionId, {
        sessionId: set.sessionId,
        performedAt: set.performedAt,
        value,
        setCount: 1,
        ...(metric === 'weightKg' && set.reps !== undefined ? { reps: set.reps } : {}),
      });
      continue;
    }

    existing.setCount += 1;

    // À charge égale, la série qui a le plus de répétitions est la meilleure.
    const isBetter =
      value > existing.value ||
      (value === existing.value &&
        metric === 'weightKg' &&
        (set.reps ?? 0) > (existing.reps ?? 0));

    if (isBetter) {
      existing.value = value;
      if (metric === 'weightKg') existing.reps = set.reps;
    }
  }

  return [...bySession.values()].sort((a, b) => a.performedAt - b.performedAt);
}

/** Écart entre les deux dernières séances, `null` s'il n'y a pas de quoi comparer. */
export function progressionDelta(points: SessionPoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[points.length - 2].value;
}

// ---------------------------------------------------------------------------
// Géométrie du tracé
// ---------------------------------------------------------------------------

export interface ChartBox {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface PlottedPoint {
  x: number;
  y: number;
  point: SessionPoint;
}

export interface ChartGeometry {
  plotted: PlottedPoint[];
  /** Tracé de la ligne. */
  line: string;
  /** Tracé de la nappe sous la ligne, refermé sur la base. */
  area: string;
  ticks: { y: number; value: number }[];
  /** Index du point le plus haut, à étiqueter directement. */
  peakIndex: number;
}

/** Graduations rondes : au plus `count`, sur un pas lisible. */
function niceTicks(min: number, max: number, count = 3): number[] {
  if (max === min) return [max];

  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }
  return ticks;
}

/**
 * Projette les points dans la boîte du SVG.
 *
 * L'axe des abscisses est **indexé par séance**, pas proportionnel au temps :
 * une graduation vaut une séance. C'est la lecture attendue pour un suivi
 * d'entraînement, et le libellé de l'axe le dit explicitement.
 */
export function buildChartGeometry(points: SessionPoint[], box: ChartBox): ChartGeometry {
  const { width, height, padding } = box;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  // Marge de 10 % pour que la ligne ne colle ni au plafond ni au plancher.
  // Une série unique, ou plusieurs séries identiques, produirait une amplitude
  // nulle et une division par zéro : on lui donne une amplitude arbitraire.
  const span = rawMax - rawMin || Math.max(rawMax * 0.2, 1);
  const min = rawMin - span * 0.1;
  const max = rawMax + span * 0.1;

  const toY = (value: number) => padding.top + plotHeight * (1 - (value - min) / (max - min));
  const toX = (index: number) =>
    padding.left + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));

  const plotted = points.map((point, index) => ({
    x: toX(index),
    y: toY(point.value),
    point,
  }));

  const line = plotted
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const base = padding.top + plotHeight;
  const area =
    plotted.length > 0
      ? `${line} L${plotted[plotted.length - 1].x.toFixed(1)},${base} L${plotted[0].x.toFixed(1)},${base} Z`
      : '';

  let peakIndex = 0;
  points.forEach((point, index) => {
    if (point.value > points[peakIndex].value) peakIndex = index;
  });

  return {
    plotted,
    line,
    area,
    ticks: niceTicks(rawMin, rawMax).map((value) => ({ y: toY(value), value })),
    peakIndex,
  };
}
