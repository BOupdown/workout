import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HistoryScreen } from '../components/history/history-screen';
import { addExerciseToSession, endSession, startSession, updateSessionText } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
});

/** One finished session, optionally named. */
async function finishedSession(title?: string) {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, squat.id);
  await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
  if (title !== undefined) await updateSessionText(session.id, { title });
  await endSession(session.id);
  return session;
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

describe('HistoryScreen', () => {
  it('dates a named session, whose name does not say which day it was', async () => {
    // A programme names its sessions: six weeks of "Push" come out as six
    // identical rows if the date only ever shows as the fallback title.
    const session = await finishedSession('Push');

    render(<HistoryScreen />);

    expect(await screen.findByText('Push')).toBeTruthy();
    const day = DAY.format(session.startedAt);
    expect(await screen.findByText(new RegExp(`^${day} · 1 exercise`))).toBeTruthy();
  });

  it('does not repeat the day when it already stands in as the title', async () => {
    const session = await finishedSession();
    const day = DAY.format(session.startedAt);

    render(<HistoryScreen />);

    expect(await screen.findByText(day)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(day))).toHaveLength(1);
  });
});
