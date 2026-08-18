'use client';

import { ArrowLeft, Check } from '@phosphor-icons/react';
import { useState } from 'react';
import { createExercise, ExerciseNameConflictError } from '@/lib/db/exercises';
import type { Exercise, MuscleGroup } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import {
  draftAllowsIncrement,
  EMPTY_EXERCISE_DRAFT,
  exerciseDraftToInput,
  LOAD_TYPE_OPTIONS,
  METRIC_OPTIONS,
  MUSCLE_GROUP_LABELS,
  type ExerciseDraft,
} from '@/lib/exercise-draft';

interface ExerciseFormSheetProps {
  /** Nom pré-rempli, quand la création part d'une recherche infructueuse. */
  initialName?: string;
  onCreated: (exercise: Exercise) => void;
  onUseExisting: (existing: Exercise) => void;
  onClose: () => void;
}

/**
 * Création d'un exercice personnalisé.
 *
 * Le champ « pas de progression » n'apparaît que là où il a un sens : au poids
 * du corps il n'y a pas de charge à incrémenter, et la validation le refuse.
 * Le formulaire ne peut donc pas fabriquer un exercice que la base rejetterait.
 *
 * Le conflit de nom n'est pas une impasse : l'erreur transporte l'exercice
 * existant, on propose donc de l'utiliser en un tap plutôt que de renvoyer
 * l'utilisateur à sa saisie.
 */
export function ExerciseFormSheet({
  initialName = '',
  onCreated,
  onUseExisting,
  onClose,
}: ExerciseFormSheetProps) {
  const [draft, setDraft] = useState<ExerciseDraft>({
    ...EMPTY_EXERCISE_DRAFT,
    name: initialName,
  });
  const [conflict, setConflict] = useState<Exercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (changes: Partial<ExerciseDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setConflict(null);
    setError(null);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const exercise = await createExercise(exerciseDraftToInput(draft));
      onCreated(exercise);
    } catch (thrown) {
      if (thrown instanceof ExerciseNameConflictError) {
        setConflict(thrown.existing);
      } else if (thrown instanceof ValidationError) {
        setError(thrown.issues[0]?.message ?? thrown.message);
      } else {
        setError('Impossible de créer l’exercice. Réessayez.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Annuler la création"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <h2 className="text-[0.9375rem] font-semibold text-ink">Nouvel exercice</h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Nom">
          <input
            type="text"
            autoComplete="off"
            autoFocus
            aria-label="Nom de l’exercice"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Face pull"
            className="h-14 w-full rounded-control border-2 border-line bg-raised px-3.5 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </Field>

        {conflict ? (
          <div role="alert" className="rounded-panel bg-raised px-4 py-3.5">
            <p className="text-sm text-ink">
              « {conflict.name} » existe déjà{conflict.archivedAt !== undefined ? ' (archivé)' : ''}.
            </p>
            <button
              type="button"
              onClick={() => onUseExisting(conflict)}
              className="mt-2.5 h-12 w-full rounded-control bg-ink text-sm font-semibold text-surface transition-transform active:scale-[0.98]"
            >
              Utiliser cet exercice
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Field label="Comment se fait la charge">
          <div className="space-y-1.5">
            {LOAD_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => patch({ loadType: option.value })}
                aria-pressed={draft.loadType === option.value}
                className={`flex min-h-14 w-full flex-col justify-center rounded-control border-2 px-3.5 py-2 text-left transition-transform active:scale-[0.99] ${
                  draft.loadType === option.value
                    ? 'border-ink bg-raised'
                    : 'border-transparent bg-raised'
                }`}
              >
                <span className="text-[0.9375rem] font-medium text-ink">{option.label}</span>
                <span className="text-xs text-muted">{option.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Ce qu’on compte">
          <div className="flex gap-1.5">
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => patch({ metric: option.value })}
                aria-pressed={draft.metric === option.value}
                className={`h-14 flex-1 rounded-control border-2 text-[0.9375rem] font-medium transition-transform active:scale-[0.98] ${
                  draft.metric === option.value
                    ? 'border-ink bg-raised text-ink'
                    : 'border-transparent bg-raised text-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        {draftAllowsIncrement(draft) ? (
          <Field label="Pas de progression" hint="valeur des boutons + et − pendant la saisie">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Pas de progression en kilogrammes"
              value={draft.defaultIncrementKg}
              onChange={(event) => patch({ defaultIncrementKg: event.target.value })}
              placeholder="2,5"
              className="h-14 w-full rounded-control border-2 border-line bg-raised px-3.5 font-mono text-base text-ink tabular-nums outline-none placeholder:text-muted focus:border-ink"
            />
          </Field>
        ) : null}

        <Field label="Groupe musculaire" hint="facultatif">
          <select
            aria-label="Groupe musculaire"
            value={draft.muscleGroup}
            onChange={(event) => patch({ muscleGroup: event.target.value as MuscleGroup | '' })}
            className="h-14 w-full rounded-control border-2 border-line bg-raised px-3 text-base text-ink outline-none focus:border-ink"
          >
            <option value="">Non précisé</option>
            {Object.entries(MUSCLE_GROUP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <button
          type="button"
          onClick={() => patch({ perSide: !draft.perSide })}
          aria-pressed={draft.perSide}
          className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-control border-2 px-3.5 text-left transition-transform active:scale-[0.99] ${
            draft.perSide ? 'border-ink bg-raised' : 'border-transparent bg-raised'
          }`}
        >
          <span>
            <span className="block text-[0.9375rem] font-medium text-ink">Compté par côté</span>
            <span className="block text-xs text-muted">
              « 10 reps » veut dire 10 par bras ou par jambe
            </span>
          </span>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              draft.perSide ? 'bg-accent text-accent-ink' : 'bg-surface text-transparent'
            }`}
          >
            <Check size={14} weight="bold" />
          </span>
        </button>
      </div>

      <div className="shrink-0 border-t border-line bg-raised px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || draft.name.trim() === ''}
          className="h-16 w-full rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? 'Création…' : 'Créer l’exercice'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* Libellé au-dessus du champ, jamais un placeholder en guise d'étiquette. */}
      <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
        {hint ? <span className="normal-case"> · {hint}</span> : null}
      </p>
      {children}
    </div>
  );
}
