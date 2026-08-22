import { describe, expect, it } from 'vitest';
import type { Exercise, MuscleGroup } from '../lib/db/types';
import { MUSCLE_GROUP_LABELS } from '../lib/exercise-draft';
import { groupByMuscle, MUSCLE_GROUP_ORDER, UNGROUPED_LABEL } from '../lib/exercise-groups';

/** Only what grouping reads. */
const exercise = (name: string, muscleGroup?: MuscleGroup): Exercise =>
  ({
    id: name,
    name,
    nameKey: name.toLowerCase(),
    loadType: 'external',
    metric: 'reps',
    perSide: false,
    isCustom: false,
    createdAt: 0,
    ...(muscleGroup ? { muscleGroup } : {}),
  }) as Exercise;

describe('MUSCLE_GROUP_ORDER', () => {
  it('place tous les groupes, une seule fois', () => {
    // Le `Record` des libellés garantit qu'un groupe est *nommé*, pas qu'il est
    // *placé* : sans ce test, ajouter un groupe compilerait et le ferait
    // disparaître du sélecteur, sans erreur nulle part.
    const named = Object.keys(MUSCLE_GROUP_LABELS).sort();
    expect([...MUSCLE_GROUP_ORDER].sort()).toEqual(named);
    expect(new Set(MUSCLE_GROUP_ORDER).size).toBe(MUSCLE_GROUP_ORDER.length);
  });
});

describe('groupByMuscle', () => {
  it('suit l’ordre anatomique, pas celui des données', () => {
    const sections = groupByMuscle([
      exercise('Calf raise', 'calves'),
      exercise('Bench press', 'chest'),
      exercise('Curl', 'biceps'),
    ]);

    expect(sections.map((section) => section.group)).toEqual(['chest', 'biceps', 'calves']);
  });

  it('regroupe sous un seul en-tête', () => {
    const sections = groupByMuscle([
      exercise('Bench press', 'chest'),
      exercise('Squat', 'quads'),
      exercise('Cable fly', 'chest'),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].exercises.map((item) => item.name)).toEqual(['Bench press', 'Cable fly']);
  });

  it('n’invente pas de section vide', () => {
    // Sinon supprimer le dernier exercice d'un groupe laisserait un titre seul.
    const sections = groupByMuscle([exercise('Bench press', 'chest')]);

    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('Chest');
  });

  it('garde l’ordre d’entrée dans une section', () => {
    // Les appelants lisent déjà le catalogue trié par nom : retrier ici
    // écraserait ce choix sans le dire.
    const sections = groupByMuscle([
      exercise('Zottman curl', 'biceps'),
      exercise('Barbell curl', 'biceps'),
    ]);

    expect(sections[0].exercises.map((item) => item.name)).toEqual([
      'Zottman curl',
      'Barbell curl',
    ]);
  });

  it('range les exercices sans groupe à la fin, sans les perdre', () => {
    // `muscleGroup` est optionnel : les écarter cacherait un exercice
    // personnalisé de l'écran qui sert justement à le retrouver.
    const sections = groupByMuscle([
      exercise('Sandbag carry'),
      exercise('Bench press', 'chest'),
    ]);

    expect(sections.at(-1)?.group).toBeNull();
    expect(sections.at(-1)?.label).toBe(UNGROUPED_LABEL);
    expect(sections.at(-1)?.exercises.map((item) => item.name)).toEqual(['Sandbag carry']);
  });

  it('ne rend aucune section sur un catalogue vide', () => {
    expect(groupByMuscle([])).toEqual([]);
  });

  it('ne perd ni ne duplique aucun exercice', () => {
    // La propriété qui compte : quoi qu'il arrive au classement, tout ce qui
    // entre ressort exactement une fois.
    const input = [
      exercise('Bench press', 'chest'),
      exercise('Squat', 'quads'),
      exercise('Sandbag carry'),
      exercise('Cable fly', 'chest'),
      exercise('Running', 'cardio'),
    ];

    const out = groupByMuscle(input).flatMap((section) => section.exercises);

    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((item) => item.id)).size).toBe(input.length);
  });
});
