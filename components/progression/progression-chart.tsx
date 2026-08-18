'use client';

import { useState } from 'react';
import { buildChartGeometry, type ProgressionMetric, type SessionPoint } from '@/lib/progression';
import { formatDuration, formatNumber } from '@/lib/format';

interface ProgressionChartProps {
  points: SessionPoint[];
  metric: ProgressionMetric;
  unit: string;
}

const BOX = {
  width: 327,
  height: 168,
  // La boîte inclut la bande des abscisses : sans elle, les libellés de dates
  // débordent et la carte se met à défiler verticalement sur quelques pixels.
  padding: { top: 18, right: 14, bottom: 26, left: 14 },
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

function formatValue(value: number, metric: ProgressionMetric): string {
  return metric === 'durationSec' ? formatDuration(value) : formatNumber(value);
}

/**
 * Courbe de progression d'un exercice.
 *
 * **Une seule grandeur en ordonnée**, jamais deux échelles : superposer charge
 * et répétitions inventerait une corrélation absente des données. Les
 * répétitions accompagnent la valeur en annotation, dans l'infobulle et dans le
 * tableau sous le graphique.
 *
 * Série unique, donc pas de boîte de légende : le titre dit déjà ce qui est
 * tracé. Étiquetage direct **sélectif** — le maximum et le dernier point — et
 * l'axe porte le reste. Aucune valeur n'est enfermée dans l'infobulle : le
 * tableau qui suit reste la source complète.
 */
export function ProgressionChart({ points, metric, unit }: ProgressionChartProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const geometry = buildChartGeometry(points, BOX);
  const { plotted, line, area, ticks, peakIndex } = geometry;

  const lastIndex = plotted.length - 1;
  const active = selected !== null ? plotted[selected] : undefined;

  // Étiquettes directes : le sommet et le dernier point. Les confondre ferait
  // deux étiquettes superposées quand le record est aussi la dernière séance.
  const labelled = new Set([peakIndex, lastIndex]);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className="w-full"
        role="img"
        aria-label={`Progression sur ${points.length} séance${points.length > 1 ? 's' : ''}, de ${formatValue(points[0].value, metric)} à ${formatValue(points[lastIndex].value, metric)} ${unit}`}
      >
        {/* Grille : filet plein d'un pas au-dessus de la surface, jamais tireté. */}
        {ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={BOX.padding.left}
              x2={BOX.width - BOX.padding.right}
              y1={tick.y}
              y2={tick.y}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={BOX.padding.left}
              y={tick.y - 4}
              className="fill-muted font-mono text-[9px] tabular-nums"
            >
              {formatValue(tick.value, metric)}
            </text>
          </g>
        ))}

        <path d={area} className="fill-chart" fillOpacity={0.1} />
        <path
          d={line}
          className="stroke-chart"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {plotted.map((p, index) => (
          <circle
            key={p.point.sessionId}
            cx={p.x}
            cy={p.y}
            r={index === lastIndex || index === selected ? 5 : 4}
            className="fill-chart stroke-raised"
            /* Anneau de 2px dans la couleur de surface : c'est lui qui détache
               le point de la ligne, pas un contour dessiné autour de la marque. */
            strokeWidth={2}
          />
        ))}

        {[...labelled].map((index) => {
          const p = plotted[index];
          const nudgeLeft = index === lastIndex && plotted.length > 1;
          return (
            <text
              key={`label-${index}`}
              x={nudgeLeft ? p.x - 6 : p.x}
              y={p.y - 10}
              textAnchor={nudgeLeft ? 'end' : index === 0 ? 'start' : 'middle'}
              className="fill-ink font-mono text-[10px] font-semibold tabular-nums"
            >
              {formatValue(p.point.value, metric)}
            </text>
          );
        })}

        {/* Zones de touche larges : la cible dépasse la marque, un point de 8px
            ne se vise pas au doigt. */}
        {plotted.map((p, index) => (
          <rect
            key={`hit-${p.point.sessionId}`}
            x={p.x - Math.max(12, BOX.width / plotted.length / 2)}
            y={0}
            width={Math.max(24, BOX.width / plotted.length)}
            height={BOX.height}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${DATE_FORMAT.format(p.point.performedAt)} : ${formatValue(p.point.value, metric)} ${unit}`}
            onClick={() => setSelected(index === selected ? null : index)}
            onFocus={() => setSelected(index)}
            className="cursor-pointer outline-none"
          />
        ))}

        <text
          x={BOX.padding.left}
          y={BOX.height - 8}
          className="fill-muted font-mono text-[9px]"
        >
          {DATE_FORMAT.format(points[0].performedAt)}
        </text>
        {plotted.length > 1 ? (
          <text
            x={BOX.width - BOX.padding.right}
            y={BOX.height - 8}
            textAnchor="end"
            className="fill-muted font-mono text-[9px]"
          >
            {DATE_FORMAT.format(points[lastIndex].performedAt)}
          </text>
        ) : null}
      </svg>

      <figcaption className="mt-1 flex items-baseline justify-between gap-2 text-[0.6875rem] text-muted">
        <span>Une graduation par séance, meilleure série de travail.</span>
        {active ? (
          <span className="shrink-0 font-mono text-ink tabular-nums">
            {DATE_FORMAT.format(active.point.performedAt)} · {formatValue(active.point.value, metric)}
            {active.point.reps !== undefined ? ` × ${active.point.reps}` : ''}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
