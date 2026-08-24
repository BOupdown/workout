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
import { TrainingBlockValidationError } from '../lib/db/validation';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('createTrainingBlock', () => {
  it('enregistre un bloc', async () => {
    const block = await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');

    expect(block.label).toBe('Strength');
    expect((await listTrainingBlocks())[0].startsOn).toBe('2026-08-03');
  });

  it('trims the whitespace around the label', async () => {
    const block = await createTrainingBlock('  Deload  ', '2026-08-03', '2026-08-30');
    expect(block.label).toBe('Deload');
  });

  it('refuses a block that sits on top of another', async () => {
    // You are not in two cycles at once. The error names the culprit:
    // "Strength already covers those days" is actionable, "invalid dates"
    // is not.
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');

    await expect(
      createTrainingBlock('Hypertrophy', '2026-08-20', '2026-09-15'),
    ).rejects.toBeInstanceOf(BlockOverlapError);

    expect(await listTrainingBlocks()).toHaveLength(1);
  });

  it('accepts a block starting the day after the last one ends', async () => {
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    await createTrainingBlock('Deload', '2026-08-31', '2026-09-06');

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength', 'Deload']);
  });

  it('refuses an end that falls before the start', async () => {
    await expect(
      createTrainingBlock('Strength', '2026-08-30', '2026-08-03'),
    ).rejects.toBeInstanceOf(TrainingBlockValidationError);
  });

  it('returns them from the oldest to the most recent', async () => {
    await createTrainingBlock('Deload', '2026-10-05', '2026-11-01');
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength', 'Deload']);
  });

  it('refuses an empty label', async () => {
    // A block with no name is a coloured band nobody can identify.
    await expect(createTrainingBlock('   ', '2026-08-03', '2026-08-30')).rejects.toBeInstanceOf(
      TrainingBlockValidationError,
    );
  });

  it('refuses a malformed date', async () => {
    await expect(createTrainingBlock('Strength', '3 August', '2026-08-30')).rejects.toBeInstanceOf(
      TrainingBlockValidationError,
    );
  });
});

describe('deleteTrainingBlock', () => {
  it('gives its days back as ordinary ones, not to the block before', async () => {
    // With an end date, the days of a deleted block belong to nobody — they do
    // not fall back to the block before it.
    const first = await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    const second = await createTrainingBlock('Hypertrophy', '2026-09-07', '2026-10-04');

    await deleteTrainingBlock(second.id);
    const remaining = await listTrainingBlocks();

    expect(blockOn(remaining, '2026-09-20')).toBeNull();
    expect(blockOn(remaining, '2026-08-10')?.id).toBe(first.id);
  });

  it('leaves the days blockless when the first one is deleted', async () => {
    const only = await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    await deleteTrainingBlock(only.id);

    expect(blockOn(await listTrainingBlocks(), '2026-08-20')).toBeNull();
  });
});

describe('blocks inside backups', () => {
  it('font l’aller-retour', async () => {
    await createTrainingBlock('Strength', '2026-08-03', '2026-08-30');
    const backup = await exportDatabase();

    await db.trainingBlocks.clear();
    await importDatabase(backup);

    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength']);
  });

  it('accept a file written before they existed', async () => {
    const legacy = await exportDatabase();
    delete legacy.trainingBlocks;

    await expect(importDatabase(legacy)).resolves.toBeDefined();
    expect(await listTrainingBlocks()).toEqual([]);
  });
});
