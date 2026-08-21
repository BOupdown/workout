import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import {
  deleteTrainingBlock,
  listTrainingBlocks,
  startTrainingBlock,
} from '../lib/db/training-blocks';
import { exportDatabase, importDatabase } from '../lib/db/backup';
import { blockOn } from '../lib/training-block';
import { SessionValidationError } from '../lib/db/validation';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('startTrainingBlock', () => {
  it('enregistre un bloc', async () => {
    const block = await startTrainingBlock('Strength', '2026-08-03');

    expect(block.label).toBe('Strength');
    expect((await listTrainingBlocks())[0].startsOn).toBe('2026-08-03');
  });

  it('coupe les espaces du libellé', async () => {
    const block = await startTrainingBlock('  Deload  ', '2026-08-03');
    expect(block.label).toBe('Deload');
  });

  it('remplace celui qui commençait le même jour', async () => {
    // Deux blocs revendiquant la même date rendraient « quel bloc couvre ce
    // jour » dépendant de l'ordre d'insertion.
    await startTrainingBlock('Strength', '2026-08-03');
    await startTrainingBlock('Hypertrophy', '2026-08-03');

    const blocks = await listTrainingBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe('Hypertrophy');
  });

  it('les rend du plus ancien au plus récent', async () => {
    await startTrainingBlock('Deload', '2026-10-05');
    await startTrainingBlock('Strength', '2026-08-03');

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength', 'Deload']);
  });

  it('refuse un libellé vide', async () => {
    // Un bloc sans nom est une bande colorée que personne ne peut identifier.
    await expect(startTrainingBlock('   ', '2026-08-03')).rejects.toBeInstanceOf(
      SessionValidationError,
    );
  });

  it('refuse une date mal formée', async () => {
    await expect(startTrainingBlock('Strength', '3 août')).rejects.toBeInstanceOf(
      SessionValidationError,
    );
  });
});

describe('deleteTrainingBlock', () => {
  it('rend ses jours au bloc précédent', async () => {
    const first = await startTrainingBlock('Strength', '2026-08-03');
    const second = await startTrainingBlock('Hypertrophy', '2026-09-07');

    await deleteTrainingBlock(second.id);

    expect(blockOn(await listTrainingBlocks(), '2026-09-20')?.id).toBe(first.id);
  });

  it('laisse les jours sans bloc quand on supprime le premier', async () => {
    const only = await startTrainingBlock('Strength', '2026-08-03');
    await deleteTrainingBlock(only.id);

    expect(blockOn(await listTrainingBlocks(), '2026-08-20')).toBeNull();
  });
});

describe('les blocs dans les sauvegardes', () => {
  it('font l’aller-retour', async () => {
    await startTrainingBlock('Strength', '2026-08-03');
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
