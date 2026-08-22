'use client';

import { useState } from 'react';
import type { WeightTrend } from '@/lib/bodyweight-trend';
import { formatNumber } from '@/lib/format';
import { buildChartGeometry } from '@/lib/progression';
import { toDisplayWeight, type WeightUnit } from '@/lib/units';

interface WeightChartProps {
  trend: WeightTrend;
  unit: WeightUnit;
  /** Shown under the chart, e.g. "August 2026". */
  windowLabel: string;
}

const BOX = {
  width: 327,
  height: 132,
  padding: { top: 18, right: 14, bottom: 22, left: 14 },
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

const dayOf = (date: string) => new Date(`${date}T00:00:00`);

/**
 * The month's weigh-ins as a curve.
 *
 * Shorter than the progression chart on purpose: it sits under a calendar
 * grid that is already the subject of the screen, and a full-height chart
 * would push the month off the fold.
 *
 * Points sit where their date falls, not at even intervals — the gaps between
 * weigh-ins are the whole reason not to read a trend into three readings from
 * one week. The first and last values are labelled directly, and the rest is
 * left to the axis rather than locked in a tooltip: the calendar above already
 * carries every number.
 */
export function WeightChart({ trend, unit, windowLabel }: WeightChartProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const { points, fractions, delta } = trend;
  const format = (value: number) => formatNumber(toDisplayWeight(value, unit));

  const { plotted, line, area, ticks } = buildChartGeometry(points, BOX, fractions);
  const lastIndex = plotted.length - 1;
  const active = selected !== null ? plotted[selected] : undefined;

  // First and last, which is what a weight window is read for. Merged, so a
  // single weigh-in does not stack two labels on one dot.
  const labelled = new Set([0, lastIndex]);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className="w-full"
        role="img"
        aria-label={`Bodyweight over ${windowLabel}: ${points.length} reading${
          points.length > 1 ? 's' : ''
        }, from ${format(points[0].value)} to ${format(points[lastIndex].value)} ${unit}`}
      >
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
            key={p.point.date}
            cx={p.x}
            cy={p.y}
            r={index === lastIndex || index === selected ? 5 : 4}
            className="fill-chart stroke-raised"
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
              textAnchor={nudgeLeft ? 'end' : index === 0 && plotted.length > 1 ? 'start' : 'middle'}
              className="fill-ink font-mono text-[10px] font-semibold tabular-nums"
            >
              {format(p.point.value)}
            </text>
          );
        })}

        {/* Wide hit areas: a 10px dot cannot be aimed at with a finger. */}
        {plotted.map((p, index) => (
          <rect
            key={`hit-${p.point.date}`}
            x={p.x - Math.max(12, BOX.width / plotted.length / 2)}
            y={0}
            width={Math.max(24, BOX.width / plotted.length)}
            height={BOX.height}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${DATE_FORMAT.format(dayOf(p.point.date))}: ${format(p.point.value)} ${unit}`}
            onClick={() => setSelected(index === selected ? null : index)}
            onFocus={() => setSelected(index)}
            className="cursor-pointer outline-none"
          />
        ))}
      </svg>

      <figcaption className="mt-1 flex items-baseline justify-between gap-2 text-[0.6875rem] text-muted">
        <span>
          {windowLabel}
          {/* The gap between the first and last reading of the window, not a
              prediction and not a weekly rate: the window is what is shown. */}
          {delta !== null ? (
            <span className="ml-1.5 font-mono text-ink tabular-nums">
              {delta > 0 ? '+' : ''}
              {format(delta)} {unit}
            </span>
          ) : null}
        </span>
        {active ? (
          <span className="shrink-0 font-mono text-ink tabular-nums">
            {DATE_FORMAT.format(dayOf(active.point.date))} · {format(active.point.value)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
