import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import type { Exercise } from '../lib/db/types';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('catalogue de départ', () => {
  it('est inséré à la création de la base', async () => {
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });

  it('couvre les quatre loadType et les deux metric', async () => {
    const catalogue = await db.exercises.toArray();
    const loadTypes = new Set(catalogue.map((e) => e.loadType));
    const metrics = new Set(catalogue.map((e) => e.metric));

    expect(loadTypes).toEqual(
      new Set(['external', 'bodyweight', 'weighted_bodyweight', 'assisted']),
    );
    expect(metrics).toEqual(new Set(['reps', 'time']));
  });

  it('n’est composé que d’exercices livrés, avec des UUID v4', async () => {
    const catalogue = await db.exercises.toArray();
    expect(catalogue.every((e) => e.isCustom === false)).toBe(true);
    expect(catalogue[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('a des nameKey tous distincts', async () => {
    const nameKeys = (await db.exercises.toArray()).map((e) => e.nameKey);
    expect(new Set(nameKeys).size).toBe(nameKeys.length);
  });

  it('repart à neuf entre deux tests', async () => {
    await db.exercises.clear();
    expect(await db.exercises.count()).toBe(0);
    await resetDatabase();
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });
});

describe('unicité de nameKey', () => {
  it('rejette un second exercice au même nom normalisé', async () => {
    const squat = await db.exercises.where('nameKey').equals('squat').first();
    expect(squat).toBeDefined();

    const duplicate: Exercise = {
      id: 'doublon',
      name: 'SQUAT !',
      nameKey: 'squat',
      loadType: 'external',
      metric: 'reps',
      perSide: false,
      isCustom: true,
      createdAt: Date.now(),
    };

    await expect(db.exercises.add(duplicate)).rejects.toThrow();
    expect(await db.exercises.where('nameKey').equals('squat').count()).toBe(1);
  });
});

describe('bornes des index composés (non-régression)', () => {
  /**
   * `Dexie.maxKey` vaut `[[]]` — une **unique instance** de tableau, partagée.
   *
   * L'algorithme « convert a value to a key » de la spec IndexedDB maintient un
   * ensemble `seen` partagé entre les éléments frères d'une clé composée et
   * rejette toute valeur déjà rencontrée. Cette détection de cycle ne distingue
   * pas un vrai cycle d'un simple doublon d'instance : réutiliser `maxKey` deux
   * fois dans la même clé lève un `DataError`.
   *
   * Avec deux composantes ça passe, avec trois ça casse — d'où un bug qui
   * n'apparaissait que sur `[exerciseId+performedAt+order]`, l'index qui porte
   * toute la progression. La couche d'écriture utilise donc des bornes
   * numériques explicites (`±Infinity`), exactes puisque `performedAt` et
   * `order` sont toujours des nombres.
   *
   * Ce test fige le comportement de la plateforme : s'il se met à passer, c'est
   * que la contrainte a disparu et que le contournement peut être réexaminé.
   */
  it('rejette une clé composée réutilisant deux fois l’instance Dexie.maxKey', () => {
    expect(() =>
      IDBKeyRange.bound(
        ['x', Dexie.minKey, Dexie.minKey],
        ['x', Dexie.maxKey, Dexie.maxKey],
      ),
    ).toThrow();
  });

  it('accepte les bornes numériques explicites utilisées par le code', () => {
    expect(() =>
      IDBKeyRange.bound(['x', -Infinity, -Infinity], ['x', Infinity, Infinity]),
    ).not.toThrow();
  });
});
