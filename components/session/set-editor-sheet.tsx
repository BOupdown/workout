'use client';

import { CaretDown, CaretUp, Check, Minus, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { deleteSet, updateSet } from '@/lib/db/sets';
import type { Exercise, SetEntry, SetKind } from '@/lib/db/types';
import { setFieldRequirements } from '@/lib/db/validation';
import { NO_MESSAGES, toFieldMessages, type FieldMessages } from '@/lib/errors';
import {
  detailFromSet,
  detailPatch,
  draftFromSet,
  draftToSetPatch,
  RPE_MAX,
  RPE_MIN,
  stepRpe,
  stepDraftValue,
  stepForField,
  visibleDraftFields,
  type DraftField,
  type SetDetailDraft,
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

  const [initialDetail] = useState<SetDetailDraft>(() => detailFromSet(set));
  const [detail, setDetail] = useState<SetDetailDraft>(initialDetail);
  // Open on its own when the set already carries something: a note you
  // cannot see is a note you will never correct.
  const [showDetail, setShowDetail] = useState(
    () => initialDetail.rpe !== null || initialDetail.isFailure || initialDetail.notes !== '',
  );

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

      await updateSet(set.id, { ...patch, ...detailPatch(initialDetail, detail) });
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
        className="max-h-[88vh] shrink-0 overflow-y-auto rounded-t-panel border-t border-line bg-raised px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
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

        {/* Behind a disclosure on purpose. This sheet exists to fix one number
            between two sets; how hard it felt, and why, is a slower intention.
            It must not push "Save" down the screen for someone who only came
            to correct a typo. */}
        <button
          type="button"
          onClick={() => setShowDetail((shown) => !shown)}
          aria-expanded={showDetail}
          className="mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-1 text-left"
        >
          <span className="text-sm font-medium text-muted">
            {detailSummary(detail) ?? 'How it felt'}
          </span>
          {showDetail ? (
            <CaretUp size={16} weight="bold" className="shrink-0 text-muted" />
          ) : (
            <CaretDown size={16} weight="bold" className="shrink-0 text-muted" />
          )}
        </button>

        {showDetail ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-control bg-surface px-3 py-2">
              <span className="flex-1 text-sm font-medium text-ink">RPE</span>

              <button
                type="button"
                disabled={busy || detail.rpe === RPE_MIN}
                onClick={() => setDetail((d) => ({ ...d, rpe: stepRpe(d.rpe, -1) }))}
                aria-label="Lower the RPE"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-raised text-ink transition-transform active:scale-90 disabled:opacity-30"
              >
                <Minus size={16} weight="bold" />
              </button>

              <span className="w-10 shrink-0 text-center font-mono text-base font-semibold text-ink tabular-nums">
                {detail.rpe ?? '—'}
              </span>

              <button
                type="button"
                disabled={busy || detail.rpe === RPE_MAX}
                onClick={() => setDetail((d) => ({ ...d, rpe: stepRpe(d.rpe, 1) }))}
                aria-label="Raise the RPE"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-raised text-ink transition-transform active:scale-90 disabled:opacity-30"
              >
                <Plus size={16} weight="bold" />
              </button>

              {/* Clearing has to exist: "not recorded" is not a low RPE, and
                  without this there would be no way back to it. */}
              <button
                type="button"
                disabled={busy || detail.rpe === null}
                onClick={() => setDetail((d) => ({ ...d, rpe: null }))}
                className="h-11 shrink-0 rounded-control px-2 text-xs font-medium text-muted transition-transform active:scale-95 disabled:opacity-30"
              >
                Clear
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => setDetail((d) => ({ ...d, isFailure: !d.isFailure }))}
              aria-pressed={detail.isFailure}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control bg-surface px-3 text-left transition-transform active:scale-[0.99] disabled:opacity-50"
            >
              <span className="text-sm font-medium text-ink">Taken to failure</span>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  detail.isFailure ? 'bg-accent text-accent-ink' : 'bg-raised text-transparent'
                }`}
              >
                <Check size={14} weight="bold" />
              </span>
            </button>

            <textarea
              rows={2}
              disabled={busy}
              aria-label="Note on this set"
              placeholder="Right shoulder pinched"
              value={detail.notes}
              onChange={(event) => setDetail((d) => ({ ...d, notes: event.target.value }))}
              className="w-full resize-none rounded-control bg-surface px-3 py-2.5 text-base text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-ink disabled:opacity-50"
            />
          </div>
        ) : null}

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

/**
 * What the collapsed row says.
 *
 * Reading the qualifiers back without opening the panel is the point:
 * otherwise the only way to learn that a set carries a note is to go looking
 * for it, which nobody does.
 */
function detailSummary(detail: SetDetailDraft): string | null {
  const parts: string[] = [];
  if (detail.rpe !== null) parts.push(`RPE ${detail.rpe}`);
  if (detail.isFailure) parts.push('to failure');
  if (detail.notes.trim() !== '') parts.push('note');

  return parts.length > 0 ? parts.join(' · ') : null;
}
