'use client';

import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useRef, useState } from 'react';
import { db } from '@/lib/db/db';
import { newId } from '@/lib/db/keys';
import { deleteRoutine, saveRoutine } from '@/lib/db/routines';
import type { Routine, RoutineExercise } from '@/lib/db/types';
import { ROUTINE_LIMITS } from '@/lib/db/validation';
import { formatDuration } from '@/lib/format';
import { DEFAULT_REST_SEC } from '@/lib/rest-timer';
import { ExercisePicker } from '@/components/session/exercise-picker';

type DraftEntry = Omit<RoutineExercise, 'target'> & { metric: 'reps' | 'time'; sets: string; repsMin: string; repsMax: string; durationSec: string; restSec: string };
type Draft = { title: string; entries: DraftEntry[]; source?: Routine };
const fromRoutine = (routine: Routine): Draft => ({ title: routine.title, source: routine, entries: routine.exercises.map((entry) => ({
  id: entry.id, exerciseId: entry.exerciseId, exerciseName: entry.exerciseName, metric: entry.target.metric,
  sets: String(entry.target.sets), restSec: String(entry.target.restSec),
  repsMin: entry.target.metric === 'reps' ? String(entry.target.repsMin) : '8',
  repsMax: entry.target.metric === 'reps' ? String(entry.target.repsMax) : '12',
  durationSec: entry.target.metric === 'time' ? String(entry.target.durationSec) : '30',
})) });

const button = 'min-h-11 rounded-control px-3 text-sm font-medium transition-transform active:scale-[0.98] disabled:opacity-40';

export function RoutinesPanel({ onClose, onStart }: { onClose: () => void; onStart: (id: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const saving = useRef(false);
  const routines = useLiveQuery(() => db.routines.orderBy('updatedAt').reverse().toArray(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState('');
  const [picking, setPicking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);

  const edit = (next: Draft) => { setDraft(next); setOriginal(JSON.stringify(next)); setDiscarding(false); setDeleting(null); setError(null); };
  const back = () => {
    if (saving.current) return;
    if (picking) { setPicking(false); return; }
    if (!draft) { onClose(); return; }
    if (JSON.stringify(draft) !== original) { setDiscarding(true); return; }
    setDraft(null); setError(null);
  };
  const run = async (action: () => Promise<void>) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save your changes. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const patch = (id: string, changes: Partial<DraftEntry>) => setDraft((current) => current ? { ...current, entries: current.entries.map((entry) => entry.id === id ? { ...entry, ...changes } : entry) } : current);
  const move = (index: number, direction: -1 | 1) => setDraft((current) => {
    if (!current || !current.entries[index + direction]) return current;
    const entries = [...current.entries];
    [entries[index], entries[index + direction]] = [entries[index + direction], entries[index]];
    return { ...current, entries };
  });

  return (
    <dialog ref={dialog} aria-labelledby={heading} className="routine-dialog" onCancel={(event) => { event.preventDefault(); back(); }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" disabled={busy} onClick={back} aria-label={draft ? 'Back to routines' : 'Close routines'} className={`${button} my-2`}><ArrowLeft size={22} aria-hidden /></button>
        <div className="min-w-0 py-3">
          <h1 id={heading} className="text-lg font-semibold">{draft ? draft.source ? 'Edit routine' : 'New routine' : 'Your routines'}</h1>
          <p className="text-xs text-muted">{draft ? 'Plan your next session. Your history stays as it is.' : 'Ready before you reach the gym.'}</p>
        </div>
      </header>
      {error ? <p role="alert" className="shrink-0 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}
      {discarding ? <div className="shrink-0 border-b border-line bg-raised p-4" role="group" aria-label="Unsaved changes">
        <p className="text-sm">Discard your unsaved changes?</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className={`${button} bg-accent text-accent-ink`} onClick={() => setDiscarding(false)}>Keep editing</button>
          <button type="button" className={`${button} text-danger`} onClick={() => { setDraft(null); setDiscarding(false); setError(null); }}>Discard changes</button>
        </div>
      </div> : null}
      {draft ? <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const exercises: RoutineExercise[] = draft.entries.map((entry) => ({
            id: entry.id, exerciseId: entry.exerciseId, exerciseName: entry.exerciseName,
            target: entry.metric === 'reps'
              ? { metric: 'reps', sets: Number(entry.sets), restSec: Number(entry.restSec), repsMin: Number(entry.repsMin), repsMax: Number(entry.repsMax) }
              : { metric: 'time', sets: Number(entry.sets), restSec: Number(entry.restSec), durationSec: Number(entry.durationSec) },
          }));
          await saveRoutine({ title: draft.title, exercises }, draft.source?.id, draft.source?.updatedAt);
          setDraft(null); setDiscarding(false);
        });
      }}>
        <fieldset disabled={busy} className="min-h-0 flex-1 space-y-3 overflow-y-auto border-0 p-4">
          <div className="rounded-panel bg-raised p-4">
            <label htmlFor={`${heading}-title`} className="text-sm font-medium">Routine name</label>
            <input id={`${heading}-title`} name="routine-title" required maxLength={ROUTINE_LIMITS.title} autoComplete="off" placeholder="Push A, Full body…" value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-2 h-12 w-full rounded-control border border-line bg-surface px-3 text-base outline-none focus:border-ink" />
          </div>
          {draft.entries.length === 0 ? <p className="py-6 text-center text-sm text-muted">Add your first exercise, then set its targets.</p> : null}
          {draft.entries.map((entry, index) => <section key={entry.id} className="rounded-panel bg-raised p-4" aria-label={`${index + 1}. ${entry.exerciseName}`}>
            <div className="mb-3 flex items-center gap-1">
              <h2 className="min-w-0 flex-1 break-words font-semibold">{index + 1}. {entry.exerciseName}</h2>
              <button type="button" disabled={index === 0} aria-label={`Move ${entry.exerciseName} up`} className={button} onClick={() => move(index, -1)}><ArrowUp size={18} aria-hidden /></button>
              <button type="button" disabled={index === draft.entries.length - 1} aria-label={`Move ${entry.exerciseName} down`} className={button} onClick={() => move(index, 1)}><ArrowDown size={18} aria-hidden /></button>
              <button type="button" aria-label={`Remove ${entry.exerciseName}`} className={`${button} text-danger`} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((value) => value.id !== entry.id) })}><Trash size={18} aria-hidden /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TargetInput entry={entry} field="sets" label="Work sets" min={1} max={30} onChange={patch} />
              <TargetInput entry={entry} field="restSec" label="Rest (seconds)" min={5} max={3600} onChange={patch} />
              {entry.metric === 'reps' ? <>
                <TargetInput entry={entry} field="repsMin" label="Minimum reps" min={1} max={1000} onChange={patch} />
                <TargetInput entry={entry} field="repsMax" label="Maximum reps" min={1} max={1000} onChange={patch} />
              </> : <TargetInput entry={entry} field="durationSec" label="Duration (seconds)" min={1} max={3600} onChange={patch} />}
            </div>
          </section>)}
          <button type="button" disabled={draft.entries.length >= ROUTINE_LIMITS.exercises} onClick={() => setPicking(true)} className={`${button} flex min-h-14 w-full items-center justify-center gap-2 border border-dashed border-line`}><Plus size={18} aria-hidden />Add exercise</button>
        </fieldset>
        <footer className="shrink-0 border-t border-line bg-raised p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <button type="submit" disabled={busy} className="h-14 w-full rounded-control bg-accent font-semibold text-accent-ink disabled:opacity-50">{busy ? 'Saving…' : 'Save routine'}</button>
        </footer>
      </form> : <>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {routines === undefined ? <p role="status" className="py-10 text-center text-muted">Loading routines…</p> : routines.length === 0 ? <div className="rounded-panel bg-raised p-6 text-center">
            <p className="font-semibold">A plan you can use again</p>
            <p className="mt-2 text-sm text-muted">Choose your exercises, sets, repetitions and rest. Start with one tap next time.</p>
          </div> : routines.map((routine) => <article key={routine.id} className="rounded-panel bg-raised p-4">
            <h2 className="break-words text-lg font-semibold">{routine.title}</h2>
            <p className="mt-1 text-xs text-muted">{routine.exercises.length} exercises · {routine.exercises.reduce((sum, entry) => sum + entry.target.sets, 0)} work sets</p>
            <ul className="my-3 space-y-2">{routine.exercises.map((entry) => <li key={entry.id} className="text-sm">
              <span className="font-medium">{entry.exerciseName}</span>
              <span className="mt-0.5 block font-mono text-xs text-muted">{entry.target.sets} × {entry.target.metric === 'reps' ? `${entry.target.repsMin}–${entry.target.repsMax} reps` : `${entry.target.durationSec}s`} · rest {formatDuration(entry.target.restSec)}</span>
            </li>)}</ul>
            {deleting === routine.id ? <div role="group" aria-label={`Delete ${routine.title}`}>
              <p className="text-sm">Delete this routine? Your completed sessions will remain.</p>
              <button type="button" disabled={busy} className={button} onClick={() => setDeleting(null)}>Keep routine</button>
              <button type="button" disabled={busy} className={`${button} text-danger`} onClick={() => void run(async () => { await deleteRoutine(routine.id); setDeleting(null); })}>Delete routine</button>
            </div> : <div className="flex gap-2">
              <button type="button" disabled={busy} className={`${button} flex-1 bg-accent text-accent-ink`} onClick={() => void run(() => onStart(routine.id))}>Start {routine.title}</button>
              <button type="button" disabled={busy} className={button} onClick={() => edit(fromRoutine(routine))}>Edit</button>
              <button type="button" disabled={busy} className={`${button} text-muted`} aria-label={`Delete ${routine.title}`} onClick={() => setDeleting(routine.id)}><Trash size={18} aria-hidden /></button>
            </div>}
          </article>)}
        </div>
        <footer className="shrink-0 border-t border-line bg-raised p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <button type="button" disabled={busy} className="h-14 w-full rounded-control bg-accent font-semibold text-accent-ink" onClick={() => edit({ title: '', entries: [] })}>Create routine</button>
        </footer>
      </>}
      {picking && draft ? <ExercisePicker onClose={() => setPicking(false)} onPick={(id) => {
        void run(async () => {
          const exercise = await db.exercises.get(id);
          if (!exercise || exercise.archivedAt !== undefined) throw new Error('This exercise is no longer available.');
          setDraft((current) => current ? { ...current, entries: [...current.entries, {
            id: newId(), exerciseId: exercise.id, exerciseName: exercise.name, metric: exercise.metric,
            sets: '3', restSec: String(DEFAULT_REST_SEC), repsMin: '8', repsMax: '12', durationSec: '30',
          }] } : current);
          setPicking(false);
        });
      }} /> : null}
    </dialog>
  );
}

function TargetInput({ entry, field, label, min, max, onChange }: { entry: DraftEntry; field: 'sets' | 'restSec' | 'repsMin' | 'repsMax' | 'durationSec'; label: string; min: number; max: number; onChange: (id: string, changes: Partial<DraftEntry>) => void }) {
  const id = `${entry.id}-${field}`;
  return <div>
    <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
    <input id={id} name={id} type="number" inputMode="numeric" required min={min} max={max} step={1} value={entry[field]} autoComplete="off"
      onChange={(event) => onChange(entry.id, { [field]: event.target.value })}
      className="mt-1 h-12 w-full rounded-control border border-line bg-surface px-3 font-mono text-lg tabular-nums outline-none focus:border-ink" />
  </div>;
}
