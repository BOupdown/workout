'use client';

import { Barbell, CaretRight, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useState } from 'react';
import { useActiveSession } from '@/hooks/use-active-session';
import { useSetDraft } from '@/hooks/use-set-draft';
import { addExerciseToSession, endSession, startSession } from '@/lib/db/sessions';
import { listSessionSummaries } from '@/lib/db/queries';
import { createSet } from '@/lib/db/sets';
import { formatElapsed } from '@/lib/format';
import type { Id, SetKind } from '@/lib/db/types';
import { NO_MESSAGES, toFieldMessages, type FieldMessages } from '@/lib/errors';
import { draftToSetInput } from '@/lib/set-draft';
import { ProgressionSheet } from '@/components/progression/progression-sheet';
import { ExercisePicker } from './exercise-picker';
import { ExerciseRow } from './exercise-row';
import { SessionHeader } from './session-header';
import { SessionSkeleton } from './session-skeleton';
import { SetEntryPanel } from './set-entry-panel';

/**
 * Écran de saisie d'une séance en cours.
 *
 * Objectif tenu : une série en deux taps quand l'exercice est déjà dans la
 * séance — un tap sur sa ligne (qui l'active *et* recharge le brouillon), un tap
 * sur « Enregistrer ». Le bloc déjà actif se répète en un seul tap, le brouillon
 * n'étant pas vidé après enregistrement.
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

  // Dérivé plutôt que synchronisé par un effet : si la sélection ne désigne plus
  // rien (bloc retiré, séance changée), on retombe sur le dernier ajouté.
  const activeEntry = entries.find((entry) => entry.id === selectedBlockId) ?? entries.at(-1);

  const controller = useSetDraft(activeEntry);

  // Resolu depuis la seance chargee : pas de requete supplementaire, et la
  // feuille se ferme d'elle-meme si le bloc disparait.
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
        draftToSetInput(activeEntry.id, controller.draft, activeEntry.exercise, { kind }),
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
          {/* L'accent porte le glyphe, il ne le colore pas : à cette luminance
              une icône verte sur fond clair serait invisible. */}
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent">
            <Barbell size={30} weight="fill" className="text-accent-ink" />
          </span>
          <h1 className="mt-5 text-[1.75rem] leading-tight font-semibold tracking-tight text-ink">
            Prêt à t’entraîner
          </h1>
          <p className="mt-2 max-w-[26ch] text-sm text-muted">
            Démarre une séance, puis enregistre tes séries au fil de l’entraînement.
          </p>
        </div>

        {/* Sans ce rappel, l'ecran d'accueil serait un cul-de-sac : un bouton et
            rien d'autre. La derniere seance repond a « qu'est-ce que j'ai fait
            la derniere fois ? » et ouvre l'historique. */}
        <LastSessionCard />

        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          className="mt-3 h-16 w-full rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Démarrage…' : 'Commencer une séance'}
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
            justLoggedSetId={justLoggedSetId}
          />
        ))}

        {entries.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">
            Ajoute un exercice pour commencer.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-panel border border-dashed border-line text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.99]"
        >
          <Plus size={18} weight="bold" />
          Ajouter un exercice
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

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Rappel de la derniere seance, avec un lien vers l'historique complet. */
function LastSessionCard() {
  const summaries = useLiveQuery(() => listSessionSummaries({ limit: 1 }), []);
  const last = summaries?.[0];

  if (!last) return null;

  const day = DAY_FORMAT.format(last.startedAt);

  return (
    <Link
      href="/historique"
      className="block rounded-panel bg-raised px-4 py-3.5 transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">Dernière séance</p>
          <p className="mt-0.5 truncate text-[0.9375rem] font-semibold text-ink">
            {last.title ?? day.charAt(0).toUpperCase() + day.slice(1)}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted tabular-nums">
            {last.exerciseCount} exercice{last.exerciseCount > 1 ? 's' : ''} · {last.setCount} série
            {last.setCount > 1 ? 's' : ''}
            {last.durationMs !== undefined ? ` · ${formatElapsed(last.durationMs)}` : ''}
          </p>
        </div>
        <CaretRight size={16} className="shrink-0 text-muted" />
      </div>
    </Link>
  );
}
