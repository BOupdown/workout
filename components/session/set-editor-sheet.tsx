'use client';

import { Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { deleteSet, updateSet } from '@/lib/db/sets';
import type { Exercise, SetEntry, SetKind } from '@/lib/db/types';
import { setFieldRequirements } from '@/lib/db/validation';
import { NO_MESSAGES, toFieldMessages, type FieldMessages } from '@/lib/errors';
import {
  draftFromSet,
  draftToSetPatch,
  stepDraftValue,
  stepForField,
  visibleDraftFields,
  type DraftField,
  type SetDraft,
} from '@/lib/set-draft';
import type { WeightUnit } from '@/lib/units';
import { NumericField } from './numeric-field';

interface SetEditorSheetProps {
  set: SetEntry;
  exercise: Exercise;
  /** Rank within the block, for the title: "Set 3". */
  position: number;
  unit: WeightUnit;
  onClose: () => void;
}

const FIELD_LABELS: Record<DraftField, string> = {
  weightKg: 'Load',
  reps: 'Reps',
  durationSec: 'Time',
};

const FIELD_MODES: Record<DraftField, 'decimal' | 'numeric'> = {
  weightKg: 'decimal',
  reps: 'numeric',
  durationSec: 'numeric',
};

/**
 * Correcting or removing a set already logged.
 *
 * A bottom sheet rather than the full-screen takeover the other flows use: you
 * are fixing one number, the session behind stays visible so you can see which
 * set you are on, and the fields land in the same thumb zone as the entry
 * panel — the gesture is identical to logging.
 *
 * The fields come from `setFieldRequirements()`, exactly as they do for entry:
 * an edit cannot introduce a measure the exercise refuses.
 *
 * Deleting asks once. Not a dialog — a second tap on the same button, which
 * says what it will do. A mis-tap between two sets must not wipe a set, but
 * neither should removing one cost a trip through a modal.
 */
export function SetEditorSheet({ set, exercise, position, unit, onClose }: SetEditorSheetProps) {
  const requirements = setFieldRequirements(exercise);
  const visibleFields = visibleDraftFields(requirements);

  // The draft as the sheet opened. Compared against on save, so a field left
  // untouched is never written: displayed in pounds, 100 kg reads "220.5", and
  // sending that back would silently store 100.017 kg. An edit that changes
  // nothing must change nothing.
  const [initial] = useState<SetDraft>(() => draftFromSet(set, exercise, unit));
  const [draft, setDraft] = useState<SetDraft>(initial);
  const [kind, setKind] = useState<SetKind>(set.kind ?? 'work');
  const [messages, setMessages] = useState<FieldMessages>(NO_MESSAGES);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const setField = (field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setMessages(NO_MESSAGES);
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const initialKind = set.kind ?? 'work';
      const patch = draftToSetPatch(draft, exercise, {
        unit,
        ...(kind !== initialKind ? { kind } : {}),
      });
      for (const field of visibleFields) {
        if (draft[field] === initial[field]) delete patch[field];
      }

      await updateSet(set.id, patch);
      onClose();
    } catch (error) {
      setMessages(toFieldMessages(error, visibleFields));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setBusy(true);
    try {
      await deleteSet(set.id);
      onClose();
    } catch (error) {
      setMessages(toFieldMessages(error, visibleFields));
      setBusy(false);
    }
  };

  const fieldUnits: Partial<Record<DraftField, string>> = { weightKg: unit, durationSec: 's' };

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      {/* Tapping outside closes without saving: the edit is not committed until
          "Save", so leaving costs nothing. */}
      <button
        type="button"
        aria-label="Close without saving"
        onClick={onClose}
        className="flex-1 bg-ink/40"
      />

      <section
        aria-label={`Edit set ${position} of ${exercise.name}`}
        style={{ touchAction: 'pan-y' }}
        className="shrink-0 rounded-t-panel border-t border-line bg-raised px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">{exercise.name}</h2>
          <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
            set {position}
          </span>
        </div>

        {messages.general.length > 0 ? (
          <div
            role="alert"
            className="mb-3 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger"
          >
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
              unit={fieldUnits[field]}
              mode={FIELD_MODES[field]}
              value={draft[field]}
              disabled={busy}
              error={messages.fields[field]}
              onChange={(value) => setField(field, value)}
              onStep={(direction) =>
                setField(
                  field,
                  stepDraftValue(draft[field], direction * stepForField(field, exercise, unit)),
                )
              }
            />
          ))}
        </div>

        <div className="mt-3 flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setKind(kind === 'warmup' ? 'work' : 'warmup')}
            aria-pressed={kind === 'warmup'}
            disabled={busy}
            className={`h-16 shrink-0 rounded-control px-3.5 text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50 ${
              kind === 'warmup' ? 'bg-ink text-surface' : 'bg-surface text-muted'
            }`}
          >
            Warm-up
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="h-16 flex-1 rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="mt-2 flex items-stretch gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-12 flex-1 rounded-control text-sm font-medium text-muted transition-transform active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-control text-sm font-semibold transition-transform active:scale-95 disabled:opacity-50 ${
              confirmingDelete ? 'bg-danger/10 text-danger' : 'text-danger'
            }`}
          >
            <Trash size={16} weight="bold" />
            {confirmingDelete ? 'Tap again to delete' : 'Delete'}
          </button>
        </div>
      </section>
    </div>
  );
}
