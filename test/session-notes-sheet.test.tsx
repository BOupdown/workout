import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionNotesSheet } from '../components/session/session-notes-sheet';
import { db } from '../lib/db/db';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise, Id } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
});

async function sessionWithOneBlock() {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, squat.id);
  return { sessionId: session.id, blockId: block.id };
}

const storedSession = (id: Id) => db.sessions.get(id);

describe('SessionNotesSheet', () => {
  it('writes the title on leaving the field, trimmed', async () => {
    const user = userEvent.setup();
    const { sessionId } = await sessionWithOneBlock();

    render(<SessionNotesSheet sessionId={sessionId} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Session name');
    await user.type(name, '  Push A  ');
    await user.tab();

    await expect.poll(async () => (await storedSession(sessionId))?.title).toBe('Push A');
  });

  it('writes what is pending when closing straight from the field', async () => {
    // The fragility this fixed: writing only on blur lost the typing when the
    // screen closed from inside the field. `fireEvent.click` does not move the
    // focus, which isolates exactly that path.
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { sessionId, blockId } = await sessionWithOneBlock();

    render(<SessionNotesSheet sessionId={sessionId} onClose={onClose} />);

    await user.type(await screen.findByLabelText('Note on the session'), 'slept badly');
    await user.type(screen.getByLabelText('Note on Squat'), 'bench too high');

    fireEvent.click(screen.getByLabelText('Close notes'));

    await expect.poll(async () => (await storedSession(sessionId))?.notes).toBe('slept badly');
    await expect
      .poll(async () => (await db.sessionExercises.get(blockId))?.notes)
      .toBe('bench too high');
    expect(onClose).toHaveBeenCalled();
  });

  it('clears the key rather than storing an empty string', async () => {
    const user = userEvent.setup();
    const { sessionId } = await sessionWithOneBlock();
    await db.sessions.update(sessionId, { title: 'Push A' });

    render(<SessionNotesSheet sessionId={sessionId} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Session name');
    await expect.poll(() => (name as HTMLInputElement).value).toBe('Push A');

    await user.clear(name);
    await user.type(name, '   ');
    await user.tab();

    await expect
      .poll(async () => {
        const stored = await storedSession(sessionId);
        return stored !== undefined && 'title' in stored;
      })
      .toBe(false);
  });

  it('leaves alone the field the patch does not carry', async () => {
    const user = userEvent.setup();
    const { sessionId } = await sessionWithOneBlock();
    await db.sessions.update(sessionId, { title: 'Push A', notes: 'garder' });

    render(<SessionNotesSheet sessionId={sessionId} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Session name');
    await expect.poll(() => (name as HTMLInputElement).value).toBe('Push A');

    await user.clear(name);
    await user.type(name, 'Pull B');
    await user.tab();

    await expect.poll(async () => (await storedSession(sessionId))?.title).toBe('Pull B');
    expect((await storedSession(sessionId))?.notes).toBe('garder');
  });

  it('lists every exercise, the ones with no note included', async () => {
    // This screen is opened *to* write a note, not to find which one already
    // accepte une.
    const { sessionId } = await sessionWithOneBlock();
    render(<SessionNotesSheet sessionId={sessionId} onClose={vi.fn()} />);

    expect(await screen.findByLabelText('Note on Squat')).toBeDefined();
  });
});
