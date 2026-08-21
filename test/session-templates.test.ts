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
  it('rend les séances de la plus récente à la plus ancienne', () => {
    const old = summary({ id: 'old', startedAt: 100 });
    const recent = summary({ id: 'recent', startedAt: 900 });

    expect(sessionTemplates([old, recent]).map((t) => t.sessionId)).toEqual(['recent', 'old']);
  });

  it('ne garde qu’une entrée par nom, la plus récente', () => {
    // Onze séances « Push A » doivent donner une ligne, pas onze.
    const first = summary({ id: 'first', title: 'Push A', startedAt: 100 });
    const middle = summary({ id: 'middle', title: 'Push A', startedAt: 500 });
    const last = summary({ id: 'last', title: 'Push A', startedAt: 900 });

    const templates = sessionTemplates([first, middle, last]);
    expect(templates).toHaveLength(1);
    expect(templates[0].sessionId).toBe('last');
  });

  it('groupe malgré la casse et les espaces', () => {
    const a = summary({ id: 'a', title: 'Push A', startedAt: 900 });
    const b = summary({ id: 'b', title: '  push a ', startedAt: 100 });

    expect(sessionTemplates([a, b])).toHaveLength(1);
  });

  it('garde les noms différents séparés', () => {
    const push = summary({ id: 'push', title: 'Push A', startedAt: 900 });
    const pull = summary({ id: 'pull', title: 'Pull B', startedAt: 800 });
    const legs = summary({ id: 'legs', title: 'Legs', startedAt: 700 });

    expect(sessionTemplates([push, pull, legs]).map((t) => t.title)).toEqual([
      'Push A',
      'Pull B',
      'Legs',
    ]);
  });

  it('laisse les séances sans nom individuelles', () => {
    // Rien ne dit que deux séances non nommées sont la même routine.
    const one = summary({ id: 'one', startedAt: 900 });
    const two = summary({ id: 'two', startedAt: 800 });

    expect(sessionTemplates([one, two]).map((t) => t.sessionId)).toEqual(['one', 'two']);
  });

  it('traite un nom vide comme une absence de nom', () => {
    const a = summary({ id: 'a', title: '   ', startedAt: 900 });
    const b = summary({ id: 'b', title: '', startedAt: 800 });

    expect(sessionTemplates([a, b])).toHaveLength(2);
  });

  it('écarte une séance sans exercice', () => {
    // Il n'y a aucune disposition à rouvrir.
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

  it('compte les entrées gardées, pas les séances lues', () => {
    // Le plafond s'applique après le regroupement : dix « Push A » puis deux
    // autres routines doivent laisser de la place à ces deux-là.
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

  it('ne modifie pas la liste reçue', () => {
    const input = [summary({ startedAt: 100 }), summary({ startedAt: 900 })];
    const before = input.map((s) => s.id);

    sessionTemplates(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });

  it('reporte les noms d’exercices pour que la ligne soit lisible', () => {
    const [template] = sessionTemplates([
      summary({ exerciseNames: ['Squat', 'Leg press'], startedAt: 900 }),
    ]);
    expect(template.exerciseNames).toEqual(['Squat', 'Leg press']);
  });
});
