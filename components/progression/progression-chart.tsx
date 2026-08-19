'use client';

import { useState } from 'react';
import { buildChartGeometry, type ProgressionMetric, type SessionPoint } from '@/lib/progression';
import { formatDuration, formatNumber } from '@/lib/format';
import { toDisplayWeight, type WeightUnit } from '@/lib/units';

interface ProgressionChartProps {
  points: SessionPoint[];
  metric: ProgressionMetric;
  unit: WeightUnit;
  label: string;
}

const BOX = {
  width: 327,
  height: 168,
  // The box includes the x-axis band: without it the date labels overflow and
  // the card grows a few pixels of nested vertical scroll.
  padding: { top: 18, right: 14, bottom: 26, left: 14 },
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * An exercise's progression curve.
 *
 * **One quantity on the y axis**, never two scales: laying load over reps would
 * invent a correlation absent from the data. Reps ride along as an annotation,
 * in the tooltip and in the table below the chart.
 *
 * A single series, so no legend box: the title already says what is plotted.
 * Direct labelling is **selective** - the maximum and the last point - and the
 * axis carries the rest. No value is locked inside the tooltip: the table that
 * follows stays the complete source.
 */
export function ProgressionChart({ points, metric, unit, label }: ProgressionChartProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const format = (value: number) =>
    metric === 'durationSec'
      ? formatDuration(value)
      : formatNumber(metric === 'weightKg' ? toDisplayWeight(value, unit) : value);

  const geometry = buildChartGeometry(points, BOX);
  const { plotted, line, area, ticks, peakIndex } = geometry;

  const lastIndex = plotted.length - 1;
  const active = selected !== null ? plotted[selected] : undefined;

  // Direct labels: the peak and the last point. Merging them avoids two labels
  // stacked on top of each other when the record is also the latest session.
  const labelled = new Set([peakIndex, lastIndex]);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className="w-full"
        role="img"
        aria-label={`Progression over ${points.length} session${points.length > 1 ? 's' : ''}, from ${format(points[0].value)} to ${format(points[lastIndex].value)} ${label}`}
      >
        {/* Grid: a solid hairline one step off the surface, never dashed. */}
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
              {format(tick.value)}
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
            /* A 2px ring in the surface colour: that is what detaches the dot
               from the line, not a border drawn around the mark. */
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
              {format(p.point.value)}
            </text>
          );
        })}

        {/* Wide hit areas: the target is bigger than the mark, an 8px dot
            cannot be aimed at with a finger. */}
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
            aria-label={`${DATE_FORMAT.format(p.point.performedAt)}: ${format(p.point.value)} ${label}`}
            onClick={() => setSelected(index === selected ? null : index)}
            onFocus={() => setSelected(index)}
            className="cursor-pointer outline-none"
          />
        ))}

        <text x={BOX.padding.left} y={BOX.height - 8} className="fill-muted font-mono text-[9px]">
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
        <span>One tick per session, best work set.</span>
        {active ? (
          <span className="shrink-0 font-mono text-ink tabular-nums">
            {DATE_FORMAT.format(active.point.performedAt)} · {format(active.point.value)}
            {active.point.reps !== undefined ? ` × ${active.point.reps}` : ''}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
