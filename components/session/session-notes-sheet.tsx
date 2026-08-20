'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { getSessionDetail } from '@/lib/db/queries';
import { setSessionExerciseNotes, updateSessionText } from '@/lib/db/sessions';
import type { Id } from '@/lib/db/types';

interface SessionNotesSheetProps {
  sessionId: Id;
  onClose: () => void;
}

/** Empty text is an absent field, never a stored empty string. */
const orUndefined = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Everything a session carries in words: its name, a note on the day, and a
 * note on each exercise.
 *
 * Gathered in one screen rather than scattered across the session view. All
 * three were modelled from the start and none had any way in — but they are
 * also the slowest thing anyone does here. Putting a note field next to the
 * entry panel would have cost the two-tap gesture a target for something
 * written once a month.
 *
 * Blocks are listed even when empty of notes: the reason to open this screen
 * is usually "the bench was set wrong on the incline press", and hunting for
 * which exercise accepts a note would defeat it.
 */
export function SessionNotesSheet({ sessionId, onClose }: SessionNotesSheetProps) {
  const detail = useLiveQuery(() => getSessionDetail(sessionId), [sessionId]);

  // Held locally while typing and written when a field is left: a live query
  // writing on every keystroke would replay the whole session detail between
  // two letters.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // The same drafts, readable without waiting for a render. Leaving a field and
  // closing the screen can land in the same tap, and the close handler must see
  // the last character typed, not the state its render was built from.
  const draftsRef = useRef<Record<string, string>>({});
  // What has already reached the database, so closing does not rewrite it.
  const savedRef = useRef<Record<string, string>>({});

  const valueFor = (key: string, stored: string | undefined) =>
    drafts[key] ?? stored ?? '';

  const edit = (key: string, value: string) => {
    draftsRef.current = { ...draftsRef.current, [key]: value };
    setDrafts(draftsRef.current);
    setError(null);
  };

  const commitSession = async (field: 'title' | 'notes') => {
    const draft = draftsRef.current[field];
    if (draft === undefined || savedRef.current[field] === draft) return;

    try {
      await updateSessionText(sessionId, { [field]: orUndefined(draft) });
      savedRef.current[field] = draft;
    } catch {
      setError('Could not save. Try again.');
    }
  };

  const commitBlock = async (blockId: Id) => {
    const draft = draftsRef.current[blockId];
    if (draft === undefined || savedRef.current[blockId] === draft) return;

    try {
      await setSessionExerciseNotes(blockId, orUndefined(draft));
      savedRef.current[blockId] = draft;
    } catch {
      setError('Could not save. Try again.');
    }
  };

  /**
   * Closing writes whatever is still pending.
   *
   * Without this, a note typed and then closed with the back arrow could be
   * lost: leaving the field is what saves it, and nothing guarantees the field
   * is left before the screen goes. Typing is the expensive part here — losing
   * it is not a small failure.
   */
  const handleClose = async () => {
    await Promise.all([
      commitSession('title'),
      commitSession('notes'),
      ...(detail?.entries ?? []).map((entry) => commitBlock(entry.id)),
    ]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close notes"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <h2 className="text-[0.9375rem] font-semibold text-ink">Notes</h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {error ? (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div>
          <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
            Name
            <span className="normal-case"> · optional</span>
          </p>
          <input
            type="text"
            autoComplete="off"
            aria-label="Session name"
            placeholder="Push A"
            value={valueFor('title', detail?.title)}
            onChange={(event) => edit('title', event.target.value)}
            onBlur={() => commitSession('title')}
            className="h-14 w-full rounded-control border-2 border-line bg-raised px-3.5 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </div>

        <div>
          <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
            The day
          </p>
          <textarea
            rows={3}
            aria-label="Note on the session"
            placeholder="Slept badly, everything felt heavy."
            value={valueFor('notes', detail?.notes)}
            onChange={(event) => edit('notes', event.target.value)}
            onBlur={() => commitSession('notes')}
            className="w-full resize-none rounded-control border-2 border-line bg-raised px-3.5 py-2.5 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </div>

        {detail && detail.entries.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Exercises
            </p>
            <div className="space-y-2">
              {detail.entries.map((entry) => (
                <div key={entry.id} className="rounded-panel bg-raised px-4 py-3">
                  <p className="truncate text-[0.9375rem] font-medium text-ink">
                    {entry.exercise.name}
                  </p>
                  <textarea
                    rows={2}
                    aria-label={`Note on ${entry.exercise.name}`}
                    placeholder="Bench set too high"
                    value={valueFor(entry.id, entry.notes)}
                    onChange={(event) => edit(entry.id, event.target.value)}
                    onBlur={() => commitBlock(entry.id)}
                    className="mt-2 w-full resize-none rounded-control bg-surface px-3 py-2 text-base text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-ink"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
