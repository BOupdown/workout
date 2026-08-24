import { describe, expect, it } from 'vitest';
import { sessionTemplates } from '../lib/session-templates';
import type { SessionSummary } from '../lib/db/types';

let next = 0;

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => {
  next += 1;
  return {
    id: `s${next}`,
    startedAt: 1_000 * next,
    date: '2026-08-20',
    exerciseCount: 2,
    exerciseNames: ['Squat', 'Bench press'],
    setCount: 6,
    ...over,
  };
};

describe('sessionTemplates', () => {
  it('returns sessions from the most recent to the oldest', () => {
    const old = summary({ id: 'old', startedAt: 100 });
    const recent = summary({ id: 'recent', startedAt: 900 });

    expect(sessionTemplates([old, recent]).map((t) => t.sessionId)).toEqual(['recent', 'old']);
  });

  it('keeps one entry per name, the most recent', () => {
    // Eleven "Push A" sessions have to come out as one row, not eleven.
    const first = summary({ id: 'first', title: 'Push A', startedAt: 100 });
    const middle = summary({ id: 'middle', title: 'Push A', startedAt: 500 });
    const last = summary({ id: 'last', title: 'Push A', startedAt: 900 });

    const templates = sessionTemplates([first, middle, last]);
    expect(templates).toHaveLength(1);
    expect(templates[0].sessionId).toBe('last');
  });

  it('groups across case and whitespace', () => {
    const a = summary({ id: 'a', title: 'Push A', startedAt: 900 });
    const b = summary({ id: 'b', title: '  push a ', startedAt: 100 });

    expect(sessionTemplates([a, b])).toHaveLength(1);
  });

  it('keeps different names apart', () => {
    const push = summary({ id: 'push', title: 'Push A', startedAt: 900 });
    const pull = summary({ id: 'pull', title: 'Pull B', startedAt: 800 });
    const legs = summary({ id: 'legs', title: 'Legs', startedAt: 700 });

    expect(sessionTemplates([push, pull, legs]).map((t) => t.title)).toEqual([
      'Push A',
      'Pull B',
      'Legs',
    ]);
  });

  it('leaves unnamed sessions on their own', () => {
    // Nothing says two unnamed sessions are the same routine.
    const one = summary({ id: 'one', startedAt: 900 });
    const two = summary({ id: 'two', startedAt: 800 });

    expect(sessionTemplates([one, two]).map((t) => t.sessionId)).toEqual(['one', 'two']);
  });

  it('treats an empty name as no name at all', () => {
    const a = summary({ id: 'a', title: '   ', startedAt: 900 });
    const b = summary({ id: 'b', title: '', startedAt: 800 });

    expect(sessionTemplates([a, b])).toHaveLength(2);
  });

  it('sets aside a session holding no exercise', () => {
    // There is no layout to reopen.
    const empty = summary({ id: 'empty', exerciseCount: 0, exerciseNames: [], startedAt: 900 });
    const usable = summary({ id: 'usable', startedAt: 800 });

    expect(sessionTemplates([empty, usable]).map((t) => t.sessionId)).toEqual(['usable']);
  });

  it('borne la liste', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      summary({ id: `x${i}`, startedAt: 10_000 - i }),
    );

    expect(sessionTemplates(many, 5)).toHaveLength(5);
  });

  it('counts the entries kept, not the sessions read', () => {
    // The cap applies after grouping: ten "Push A" followed by two other
    // routines have to leave room for those two.
    const pushes = Array.from({ length: 10 }, (_, i) =>
      summary({ id: `p${i}`, title: 'Push A', startedAt: 9_000 - i }),
    );
    const pull = summary({ id: 'pull', title: 'Pull B', startedAt: 500 });
    const legs = summary({ id: 'legs', title: 'Legs', startedAt: 400 });

    expect(sessionTemplates([...pushes, pull, legs], 3).map((t) => t.title)).toEqual([
      'Push A',
      'Pull B',
      'Legs',
    ]);
  });

  it('leaves the list it was given alone', () => {
    const input = [summary({ startedAt: 100 }), summary({ startedAt: 900 })];
    const before = input.map((s) => s.id);

    sessionTemplates(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });

  it('carries the exercise names over, so the row can be read', () => {
    const [template] = sessionTemplates([
      summary({ exerciseNames: ['Squat', 'Leg press'], startedAt: 900 }),
    ]);
    expect(template.exerciseNames).toEqual(['Squat', 'Leg press']);
  });
});
