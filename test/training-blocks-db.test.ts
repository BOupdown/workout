import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import {
  BlockOverlapError,
  createTrainingBlock,
  deleteTrainingBlock,
  listTrainingBlocks,
} from '../lib/db/training-blocks';
import { exportDatabase, importDatabase } from '../lib/db/backup';
import { blockOn } from '../lib/training-block';
import { SessionValidationError } from '../lib/db/validation';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('createTrainingBlock', () => {
  it('enregistre un bloc', async () => {
    const block = await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');

    expect(block.label).toBe('Strength');
    expect((await listTrainingBlocks())[0].startsOn).toBe('2026-08-03');
  });

  it('coupe les espaces du libellé', async () => {
    const block = await createTrainingBlock('  Deload  ', '2026-08-03', '2026-08-30');
    expect(block.label).toBe('Deload');
  });

  it('refuse un bloc qui en chevauche un autre', async () => {
    // On n'est pas dans deux cycles à la fois. L'erreur nomme le coupable :
    // « Strength couvre déjà ces jours » est actionnable, « dates invalides »
    // ne l'est pas.
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');

    await expect(
      createTrainingBlock('Hypertrophy', '2026-08-20', '2026-09-15'),
    ).rejects.toBeInstanceOf(BlockOverlapError);

    expect(await listTrainingBlocks()).toHaveLength(1);
  });

  it('accepte un bloc commençant le lendemain de la fin', async () => {
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    await createTrainingBlock('Deload', '2026-08-31', '2026-09-06');

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength', 'Deload']);
  });

  it('refuse une fin antérieure au début', async () => {
    await expect(
      createTrainingBlock('Strength', '2026-08-30', '2026-08-03'),
    ).rejects.toBeInstanceOf(SessionValidationError);
  });

  it('les rend du plus ancien au plus récent', async () => {
    await createTrainingBlock('Deload', '2026-10-05', '2026-11-01');
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength', 'Deload']);
  });

  it('refuse un libellé vide', async () => {
    // Un bloc sans nom est une bande colorée que personne ne peut identifier.
    await expect(createTrainingBlock('   ', '2026-08-03', '2026-08-30')).rejects.toBeInstanceOf(
      SessionValidationError,
    );
  });

  it('refuse une date mal formée', async () => {
    await expect(createTrainingBlock('Strength', '3 août', '2026-08-30')).rejects.toBeInstanceOf(
      SessionValidationError,
    );
  });
});

describe('deleteTrainingBlock', () => {
  it('rend ses jours ordinaires, sans les donner au précédent', async () => {
    // Avec une date de fin, les jours d'un bloc supprimé n'appartiennent plus à
    // personne — ils ne remontent pas au bloc d'avant.
    const first = await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    const second = await createTrainingBlock('Hypertrophy', '2026-09-07', '2026-10-04');

    await deleteTrainingBlock(second.id);
    const remaining = await listTrainingBlocks();

    expect(blockOn(remaining, '2026-09-20')).toBeNull();
    expect(blockOn(remaining, '2026-08-10')?.id).toBe(first.id);
  });

  it('laisse les jours sans bloc quand on supprime le premier', async () => {
    const only = await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    await deleteTrainingBlock(only.id);

    expect(blockOn(await listTrainingBlocks(), '2026-08-20')).toBeNull();
  });
});

describe('les blocs dans les sauvegardes', () => {
  it('font l’aller-retour', async () => {
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    const backup = await exportDatabase();

    await db.trainingBlocks.clear();
    await importDatabase(backup);

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength']);
  });

  it('acceptent un fichier écrit avant leur existence', async () => {
    const legacy = await exportDatabase();
    delete legacy.trainingBlocks;

    await expect(importDatabase(legacy)).resolves.toBeDefined();
    expect(await listTrainingBlocks()).toEqual([]);
  });
});
