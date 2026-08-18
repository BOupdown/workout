'use client';

import { Check, TrendUp } from '@phosphor-icons/react';
import type { SetDraftController } from '@/hooks/use-set-draft';
import type { FieldMessages } from '@/lib/errors';
import type { SessionExerciseWithSets, SetKind } from '@/lib/db/types';
import { stepDraftValue, stepForField, type DraftField } from '@/lib/set-draft';
import { NumericField } from './numeric-field';

interface SetEntryPanelProps {
  entry: SessionExerciseWithSets;
  controller: SetDraftController;
  messages: FieldMessages;
  saving: boolean;
  onSave: () => void;
  onShowProgression: () => void;
  kind: SetKind;
  onKindChange: (kind: SetKind) => void;
}

/** Le libellé de la charge vient de la validation ; les deux autres sont fixes. */
const FIELD_LABELS: Record<DraftField, string> = {
  weightKg: 'Charge',
  reps: 'Répétitions',
  durationSec: 'Durée',
};

const FIELD_UNITS: Partial<Record<DraftField, string>> = { weightKg: 'kg', durationSec: 's' };

const FIELD_MODES: Record<DraftField, 'decimal' | 'numeric'> = {
  weightKg: 'decimal',
  reps: 'numeric',
  durationSec: 'numeric',
};

const ORIGIN_LABELS: Record<string, string | null> = {
  none: null,
  block: null,
  session: 'série précédente',
  history: 'dernière séance',
};

/**
 * Zone de saisie, ancrée en bas dans la portée du pouce.
 *
 * Les champs rendus sont **exactement** ceux que `setFieldRequirements()` déclare
 * requis, et le libellé de la charge est celui qu'elle fournit. L'écran ne peut
 * donc pas fabriquer une série que la base refuserait : un champ interdit
 * n'existe simplement pas.
 */
export function SetEntryPanel({
  entry,
  controller,
  messages,
  saving,
  onSave,
  onShowProgression,
  kind,
  onKindChange,
}: SetEntryPanelProps) {
  const { draft, setField, requirements, visibleFields, referenceOrigin } = controller;

  if (!requirements) return null;

  const originLabel = ORIGIN_LABELS[referenceOrigin];
  const nextSetNumber = entry.sets.length + 1;

  return (
    <section
      aria-label={`Saisie d’une série de ${entry.exercise.name}`}
      className="shrink-0 border-t border-line bg-raised px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* Le nom se tronque, la méta ne disparaît jamais : sans `shrink-0`,
            « Extension triceps à la poulie » l'éjecterait. */}
        <button
          type="button"
          onClick={onShowProgression}
          aria-label={`Voir la progression de ${entry.exercise.name}`}
          className="-ml-1 flex min-h-11 min-w-0 items-center gap-1.5 rounded-control px-1 text-left transition-transform active:scale-[0.98]"
        >
          <span className="truncate text-[0.9375rem] font-semibold text-ink">
            {entry.exercise.name}
          </span>
          <TrendUp size={15} weight="bold" className="shrink-0 text-muted" />
        </button>

        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          série {nextSetNumber}
          {originLabel ? <span className="font-sans"> · {originLabel}</span> : null}
        </span>
      </div>

      {messages.general.length > 0 ? (
        <div role="alert" className="mb-3 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {messages.general.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-2.5">
        {visibleFields.map((field) => (
          <NumericField
            key={field}
            label={
              field === 'weightKg'
                ? (requirements.weightLabel ?? FIELD_LABELS.weightKg)
                : FIELD_LABELS[field]
            }
            unit={FIELD_UNITS[field]}
            mode={FIELD_MODES[field]}
            value={draft[field]}
            disabled={saving}
            error={messages.fields[field]}
            onChange={(value) => setField(field, value)}
            onStep={(direction) =>
              setField(
                field,
                stepDraftValue(draft[field], direction * stepForField(field, entry.exercise)),
              )
            }
          />
        ))}
      </div>

      <div className="mt-3 flex items-stretch gap-2">
        {/* Le marquage echauffement n'est pas cosmetique : c'est lui qui tient
            les series de montee en charge hors de la courbe de progression.
            Volontairement persistant d'une serie a l'autre, on en enchaine
            plusieurs. */}
        <button
          type="button"
          onClick={() => onKindChange(kind === 'warmup' ? 'work' : 'warmup')}
          aria-pressed={kind === 'warmup'}
          className={`h-16 shrink-0 rounded-control px-3.5 text-xs font-semibold transition-transform active:scale-95 ${
            kind === 'warmup'
              ? 'bg-ink text-surface'
              : 'bg-surface text-muted'
          }`}
        >
          Échauff.
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex h-16 flex-1 items-center justify-center gap-2 rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Check size={22} weight="bold" />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </section>
  );
}
