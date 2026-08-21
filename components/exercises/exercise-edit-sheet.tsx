'use client';

import { ArrowLeft, Archive, ArrowCounterClockwise, Trash } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import {
  archiveExercise,
  deleteExercise,
  ExerciseNameConflictError,
  unarchiveExercise,
  updateExercise,
} from '@/lib/db/exercises';
import { countSetsForExercise } from '@/lib/db/sets';
import type { Exercise } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import { exerciseDraftToUpdate, exerciseToDraft, type ExerciseDraft } from '@/lib/exercise-draft';
import { ExerciseFields } from './exercise-fields';

interface ExerciseEditSheetProps {
  exercise: Exercise;
  onSaved: (exercise: Exercise) => void;
  /** The row is gone: whatever else is showing it has to close too. */
  onDeleted: () => void;
  onClose: () => void;
}

/**
 * Editing an exercise already in the catalogue.
 *
 * The catalogue used to be write-once: a name typed wrong, or the wrong load
 * type chosen in a hurry, stayed that way forever. Everything needed already
 * existed in `lib/db/exercises` — only the screen was missing.
 *
 * Two ways out, and which one is offered is not a preference. Archiving keeps
 * every set and only clears the picker — the only safe answer once an exercise
 * has been trained, because a `SetEntry` points at it. Deleting is offered only
 * while nothing has been logged: the shipped catalogue is wide so nobody has to
 * create a bench press by hand, and the cost of that is rows a given person
 * will never use.
 */
export function ExerciseEditSheet({
  exercise,
  onSaved,
  onDeleted,
  onClose,
}: ExerciseEditSheetProps) {
  const [draft, setDraft] = useState<ExerciseDraft>(() => exerciseToDraft(exercise));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Read live rather than passed in: it decides which fields are frozen, and a
  // stale count would either lock a free field or offer an edit the database
  // is about to refuse.
  const setCount = useLiveQuery(() => countSetsForExercise(exercise.id), [exercise.id]);
  const archived = exercise.archivedAt !== undefined;

  const patch = (changes: Partial<ExerciseDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      onSaved(await updateExercise(exercise.id, exerciseDraftToUpdate(draft)));
    } catch (thrown) {
      if (thrown instanceof ExerciseNameConflictError) {
        setError(`“${thrown.existing.name}” already exists. Pick another name.`);
      } else if (thrown instanceof ValidationError) {
        setError(thrown.issues[0]?.message ?? thrown.message);
      } else {
        setError('Could not save the changes. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    setSaving(true);
    try {
      onSaved(archived ? await unarchiveExercise(exercise.id) : await archiveExercise(exercise.id));
    } catch {
      setError(archived ? 'Could not restore the exercise.' : 'Could not archive the exercise.');
    } finally {
      setSaving(false);
      setConfirmingArchive(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteExercise(exercise.id);
      onDeleted();
    } catch {
      // Covers the race the check cannot: a set logged in another tab between
      // the count landing and this click. The database refuses, and saying so
      // beats a delete that looks like it worked.
      setError('Could not delete the exercise. It may have been used since.');
      setConfirmingDelete(false);
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
          aria-label="Cancel editing"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">Edit exercise</h2>
          {archived ? <p className="text-xs text-muted">Archived</p> : null}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {error ? (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <ExerciseFields draft={draft} patch={patch} lockedSetCount={setCount ?? 0} />

        <div className="rounded-panel bg-raised px-4 py-3.5">
          <h3 className="text-[0.9375rem] font-semibold text-ink">
            {archived ? 'Put it back' : 'Archive'}
          </h3>
          <p className="mt-1.5 text-sm text-muted">
            {archived
              ? 'It will appear in the picker again. Its history never left.'
              : 'It leaves the picker without losing a single set. Reversible from here.'}
          </p>

          {confirmingArchive && !archived ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingArchive(false)}
                className="h-14 flex-1 rounded-control bg-surface text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveToggle}
                disabled={saving}
                className="h-14 flex-1 rounded-control bg-ink text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                Archive
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (archived ? handleArchiveToggle() : setConfirmingArchive(true))}
              disabled={saving}
              className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-control bg-surface text-[0.9375rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {archived ? (
                <ArrowCounterClockwise size={18} weight="bold" />
              ) : (
                <Archive size={18} weight="bold" />
              )}
              {archived ? 'Restore this exercise' : 'Archive this exercise'}
            </button>
          )}
        </div>

        {/* Only while the exercise has never been trained. With one set logged,
            deleting would be deleting a session, and archiving is upstairs. */}
        {setCount === 0 ? (
          <div className="rounded-panel bg-raised px-4 py-3.5">
            <h3 className="text-[0.9375rem] font-semibold text-ink">Delete</h3>
            <p className="mt-1.5 text-sm text-muted">
              Nothing has been logged for this exercise, so there is no history to lose. It
              leaves the catalogue for good, and a later update will not bring it back.
            </p>

            {confirmingDelete ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="h-14 flex-1 rounded-control bg-surface text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="h-14 flex-1 rounded-control bg-danger text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
                className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-control bg-surface text-[0.9375rem] font-semibold text-danger transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                <Trash size={18} weight="bold" />
                Delete this exercise
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line bg-raised px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || draft.name.trim() === ''}
          className="h-16 w-full rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
