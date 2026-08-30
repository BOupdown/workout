'use client';

import { useState, type ReactNode } from 'react';
import { formatNumber, parseNumberInput } from '@/lib/format';
import {
  BAR_PRESETS,
  describePerSide,
  MAX_BAR,
  PLATE_DENOMINATIONS,
  solvePlates,
  type PlateResult,
} from '@/lib/plates';
import { usePlateSetup } from '@/hooks/use-plate-setup';
import type { WeightUnit } from '@/lib/units';

interface PlateSheetProps {
  /** The load being aimed at, in the display unit. `null` when unreadable. */
  target: number | null;
  unit: WeightUnit;
  onClose: () => void;
}

/**
 * What to put on the bar for the load in the field.
 *
 * A **reading**, never a second way to enter the load: the target comes from
 * the entry panel and cannot be changed here. Two fields holding one number is
 * two fields that will disagree, and the one that would lose is the one the set
 * is written from.
 *
 * The bar, on the other hand, belongs here rather than in the settings. It
 * changes with the exercise — a 20 kg Olympic for the squat, an EZ bar for
 * curls, ten minutes apart — whereas which plates the rack holds changes when
 * you change gym, which is why that half of the setup lives in the settings.
 */
export function PlateSheet({ target, unit, onClose }: PlateSheetProps) {
  const setup = usePlateSetup(unit);
  const result = solvePlates(target, setup.barWeight, setup.plates);

  const isPreset = BAR_PRESETS[unit].includes(setup.barWeight);
  const [customOpen, setCustomOpen] = useState(false);
  const [barDraft, setBarDraft] = useState<string | null>(null);
  const showCustom = customOpen || !isPreset;

  const settleBar = () => {
    if (barDraft !== null) {
      const parsed = parseNumberInput(barDraft);
      if (parsed !== null) setup.setBarWeight(parsed);
    }
    setBarDraft(null);
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close the plate calculator"
        onClick={onClose}
        className="flex-1 bg-ink/40"
      />

      <section
        aria-label="Plates on the bar"
        style={{ touchAction: 'pan-y' }}
        /* The tallest sheet in the app — a drawing, a reading and two rows of
           buttons — and the only one that has to survive a short screen. It
           scrolls inside itself rather than pushing its own footer off. */
        className="max-h-[88dvh] overflow-y-auto rounded-t-panel border-t border-line bg-raised px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[0.9375rem] font-semibold text-ink">Plates</h2>
          <p className="font-mono text-sm text-muted tabular-nums">
            target {target === null ? '—' : `${formatNumber(target)} ${unit}`}
          </p>
        </div>

        <Loading result={result} unit={unit} plates={setup.plates} />

        <h3 className="mt-4 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Bar
        </h3>

        <div className="mt-2 flex gap-1.5">
          {BAR_PRESETS[unit].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setCustomOpen(false);
                setBarDraft(null);
                setup.setBarWeight(preset);
              }}
              aria-pressed={setup.barWeight === preset}
              className={`h-12 flex-1 rounded-control border-2 font-mono text-[0.9375rem] font-semibold tabular-nums transition-transform active:scale-[0.98] ${
                setup.barWeight === preset
                  ? 'border-ink bg-raised text-ink'
                  : 'border-transparent bg-surface text-muted'
              }`}
            >
              {formatNumber(preset)}
            </button>
          ))}
        </div>

        {/* Four bars cannot cover every rack: a trap bar, a safety squat bar and
            a fixed-weight barbell are all real, and a calculator that is wrong
            by a known constant is worse than one that asks. Same shape as the
            custom rest duration — the presets stay the one-tap path. */}
        {showCustom ? (
          <div
            className={`mt-1.5 flex items-center gap-2 rounded-control border-2 px-3 py-2 ${
              isPreset ? 'border-line' : 'border-ink'
            }`}
          >
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              aria-label="Bar weight"
              value={barDraft ?? formatNumber(setup.barWeight)}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setBarDraft(event.target.value)}
              onBlur={settleBar}
              className="h-12 min-w-0 flex-1 rounded-control border-2 border-line bg-surface text-center font-mono text-xl font-semibold text-ink tabular-nums outline-none focus:border-ink"
            />
            <span className="shrink-0 text-sm text-muted">
              {unit}, up to {MAX_BAR}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="mt-1.5 h-12 w-full rounded-control border-2 border-transparent bg-surface text-[0.9375rem] font-semibold text-muted transition-transform active:scale-[0.98]"
          >
            Another bar
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 h-14 w-full rounded-control bg-surface text-[0.9375rem] font-semibold text-ink transition-transform active:scale-[0.98]"
        >
          Done
        </button>
      </section>
    </div>
  );
}

/**
 * The answer: a bar seen from above, then the same thing in words.
 *
 * Both, not one or the other. The drawing is what is read at a glance while
 * walking to the rack; the sentence underneath is what is checked against the
 * plates already on the bar, and it is the only one that survives being read
 * aloud to somebody else.
 */
function Loading({
  result,
  unit,
  plates,
}: {
  result: PlateResult;
  unit: WeightUnit;
  plates: number[];
}) {
  if (result.status === 'no-target') {
    return <Note>Type a load and the plates for one side appear here.</Note>;
  }

  if (result.status === 'out-of-range') {
    return <Note>That is more weight than a bar holds. Check the load.</Note>;
  }

  if (result.status === 'below-bar') {
    return <Note>Lighter than the bar on its own. Pick a lighter bar, or a heavier load.</Note>;
  }

  if (plates.length === 0) {
    return <Note>No plates are turned on. Settings say which ones your gym has.</Note>;
  }

  return (
    <>
      <Barbell perSide={result.perSide} unit={unit} />

      <p className="mt-2.5 text-center font-mono text-lg font-semibold text-ink tabular-nums">
        {describePerSide(result.perSide)}
      </p>
      {result.perSide.length > 0 ? (
        <p className="mt-0.5 text-center text-xs text-muted">
          per side · {result.perSide.length} plate{result.perSide.length > 1 ? 's' : ''}
        </p>
      ) : null}

      {result.shortfall > 0 ? (
        /* Not an error: the plates simply do not add up to what was asked, and
           the honest thing is to name the gap rather than round the bar up to a
           weight that cannot be built. */
        <p role="status" className="mt-2.5 rounded-control bg-surface px-3 py-2 text-center text-xs text-muted">
          Closest your plates reach is{' '}
          <span className="font-mono font-semibold text-ink tabular-nums">
            {formatNumber(result.total)} {unit}
          </span>{' '}
          — {formatNumber(result.shortfall)} {unit} short.
        </p>
      ) : null}
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-control bg-surface px-3 py-4 text-center text-sm text-muted">
      {children}
    </p>
  );
}

/**
 * One sleeve, loaded, inside first.
 *
 * Heights are proportional to the plate, floored at 45% of the heaviest — which
 * is roughly the real ratio between a 1.25 and a 25 (160 mm against 450) and,
 * more to the point, the floor below which the number printed on it stops being
 * legible. Reading it is the entire job.
 */
function Barbell({ perSide, unit }: { perSide: number[]; unit: WeightUnit }) {
  const heaviest = PLATE_DENOMINATIONS[unit][0];

  return (
    <div
      aria-hidden
      className="mt-3 flex h-28 items-center gap-[3px] overflow-x-auto rounded-control bg-surface px-3 py-2.5"
    >
      <div className="h-1.5 w-4 shrink-0 rounded-l-full bg-muted/40" />

      {perSide.length === 0 ? (
        <span className="flex-1 text-center text-sm text-muted">Bar only</span>
      ) : (
        perSide.map((plate, index) => (
          <div
            key={`${plate}-${index}`}
            style={{ height: `${45 + 55 * Math.min(1, plate / heaviest)}%` }}
            className="flex w-8 shrink-0 items-center justify-center rounded-[4px] bg-ink font-mono text-[10px] font-semibold text-surface tabular-nums"
          >
            {formatNumber(plate)}
          </div>
        ))
      )}

      <div className="h-1.5 w-5 shrink-0 bg-muted/40" />
      <div className="h-5 w-1.5 shrink-0 rounded-full bg-muted/40" />
    </div>
  );
}
