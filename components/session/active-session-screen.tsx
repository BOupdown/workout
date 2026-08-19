'use client';

import { Barbell, CaretRight, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useActiveSession } from '@/hooks/use-active-session';
import { useSetDraft } from '@/hooks/use-set-draft';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import { addExerciseToSession, endSession, startSession } from '@/lib/db/sessions';
import { listSessionSummaries } from '@/lib/db/queries';
import { createSet } from '@/lib/db/sets';
import { formatElapsed } from '@/lib/format';
import type { Id, SetKind } from '@/lib/db/types';
import { NO_MESSAGES, toFieldMessages, type FieldMessages } from '@/lib/errors';
import { draftToSetInput } from '@/lib/set-draft';
import { ProgressionSheet } from '@/components/progression/progression-sheet';
import { SessionDetailSheet } from '@/components/history/session-detail-sheet';
import { ExercisePicker } from './exercise-picker';
import { ExerciseRow } from './exercise-row';
import { SessionHeader } from './session-header';
import { SessionSkeleton } from './session-skeleton';
import { SetEntryPanel } from './set-entry-panel';

/**
 * Entry screen for a session in progress.
 *
 * The goal it holds: one set in two taps when the exercise is already in the
 * session - one tap on its row (which activates it *and* reloads the draft),
 * one tap on "Save set". The already-active block repeats in a single tap,
 * since the draft is not cleared after saving.
 */
export function ActiveSessionScreen() {
  const state = useActiveSession();
  const [selectedBlockId, setSelectedBlockId] = useState<Id | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [messages, setMessages] = useState<FieldMessages>(NO_MESSAGES);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justLoggedSetId, setJustLoggedSetId] = useState<Id | undefined>();
  const [progressionFor, setProgressionFor] = useState<Id | null>(null);
  const [kind, setKind] = useState<SetKind>('work');

  const detail = state.status === 'ready' ? state.detail : undefined;
  const entries = detail?.entries ?? [];

  // Derived rather than synchronised by an effect: if the selection no longer
  // points at anything (block removed, session changed), we fall back to the
  // last one added.
  const activeEntry = entries.find((entry) => entry.id === selectedBlockId) ?? entries.at(-1);

  const controller = useSetDraft(activeEntry);
  const [unit] = useWeightUnit();

  // Resolved from the loaded session: no extra query, and the sheet closes by
  // itself if the block disappears.
  const progressionExercise = entries.find((e) => e.exercise.id === progressionFor)?.exercise;

  const handleStart = async () => {
    setBusy(true);
    try {
      await startSession();
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await endSession(detail.id);
      setSelectedBlockId(null);
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async (exerciseId: Id) => {
    if (!detail) return;
    const block = await addExerciseToSession(detail.id, exerciseId);
    setSelectedBlockId(block.id);
    setMessages(NO_MESSAGES);
    setKind('work');
    setPickerOpen(false);
  };

  const handleSave = async () => {
    if (!activeEntry) return;

    setSaving(true);
    try {
      const set = await createSet(
        draftToSetInput(activeEntry.id, controller.draft, activeEntry.exercise, { kind, unit }),
      );
      setMessages(NO_MESSAGES);
      setJustLoggedSetId(set.id);
    } catch (error) {
      setMessages(toFieldMessages(error, controller.visibleFields));
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading') return <SessionSkeleton />;

  if (state.status === 'none') {
    return (
      <main className="flex h-full flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          {/* The accent carries the glyph, it does not colour it: at this
              lightness a green icon on a light background would be invisible. */}
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent">
            <Barbell size={30} weight="fill" className="text-accent-ink" />
          </span>
          <h1 className="mt-5 text-[1.75rem] leading-tight font-semibold tracking-tight text-ink">
            Ready to train
          </h1>
          <p className="mt-2 max-w-[26ch] text-sm text-muted">
            Start a session, then log your sets as you go.
          </p>
        </div>

        {/* Without this reminder the home screen would be a dead end: one
            button and nothing else. The last session answers "what did I do
            last time?" and opens straight into it. */}
        <LastSessionCard />

        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          className="mt-3 h-16 w-full rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start a session'}
        </button>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
      <SessionHeader detail={state.detail} onEnd={handleEnd} ending={busy} />

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {entries.map((entry) => (
          <ExerciseRow
            key={entry.id}
            entry={entry}
            isActive={entry.id === activeEntry?.id}
            onSelect={() => {
              setSelectedBlockId(entry.id);
              setMessages(NO_MESSAGES);
              setKind('work');
            }}
            unit={unit}
            justLoggedSetId={justLoggedSetId}
          />
        ))}

        {entries.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">
            Add an exercise to get started.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-panel border border-dashed border-line text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.99]"
        >
          <Plus size={18} weight="bold" />
          Add exercise
        </button>
      </div>

      {activeEntry ? (
        <SetEntryPanel
          entry={activeEntry}
          controller={controller}
          messages={messages}
          saving={saving}
          onSave={handleSave}
          onShowProgression={() => setProgressionFor(activeEntry.exercise.id)}
          unit={unit}
          kind={kind}
          onKindChange={setKind}
        />
      ) : null}

      {pickerOpen ? (
        <ExercisePicker onPick={handlePick} onClose={() => setPickerOpen(false)} />
      ) : null}

      {progressionExercise ? (
        <ProgressionSheet
          exercise={progressionExercise}
          onClose={() => setProgressionFor(null)}
        />
      ) : null}
    </main>
  );
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * A reminder of the last session, which opens it directly.
 *
 * It opens the detail in place rather than routing to the history: the question
 * being asked is "what did I do last time?", not "show me the list". Closing
 * the detail therefore comes back here, not to another tab.
 */
function LastSessionCard() {
  const summaries = useLiveQuery(() => listSessionSummaries({ limit: 1 }), []);
  const [open, setOpen] = useState(false);
  const last = summaries?.[0];

  if (!last) return null;

  const day = DAY_FORMAT.format(last.startedAt);

  return (
    <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="block w-full rounded-panel bg-raised px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">Last session</p>
          <p className="mt-0.5 truncate text-[0.9375rem] font-semibold text-ink">
            {last.title ?? day}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted tabular-nums">
            {last.exerciseCount} exercise{last.exerciseCount > 1 ? 's' : ''} · {last.setCount} set
            {last.setCount > 1 ? 's' : ''}
            {last.durationMs !== undefined ? ` · ${formatElapsed(last.durationMs)}` : ''}
          </p>
        </div>
        <CaretRight size={16} className="shrink-0 text-muted" />
      </div>
    </button>

    {open ? <SessionDetailSheet sessionId={last.id} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
