import { describe, expect, it } from 'vitest';
import { isLocalDate, localMidnight, newId, toLocalDate, toNameKey } from '../lib/db/keys';

describe('toNameKey', () => {
  it('retire les accents', () => {
    expect(toNameKey('Bench press')).toBe('bench press');
  });

  it('fait converger les variantes d’un même mouvement', () => {
    expect(toNameKey('Bench-Press  ')).toBe(toNameKey('bench press'));
    expect(toNameKey('BENCH   PRESS')).toBe(toNameKey('bench press'));
  });

  it('neutralise ponctuation et casse', () => {
    expect(toNameKey('One-arm dumbbell row')).toBe('one arm dumbbell row');
    expect(toNameKey("Curl 'biceps' !")).toBe('curl biceps');
  });
});

describe('newId', () => {
  it('génère un UUID v4', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('ne se répète pas', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });
});

describe('dates locales', () => {
  it('accepte un jour réel', () => {
    expect(isLocalDate('2026-08-16')).toBe(true);
  });

  it('rejette un jour qui n’existe pas', () => {
    // Sans contrôle de débordement, `new Date(2026, 1, 30)` glisserait au 2 mars.
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('16/08/2026')).toBe(false);
    expect(isLocalDate(20260816)).toBe(false);
  });

  it('fait l’aller-retour timestamp ↔ jour local', () => {
    const midnight = localMidnight('2026-08-16');
    expect(toLocalDate(midnight)).toBe('2026-08-16');
  });

  it('reste sur le bon jour en fin de soirée', () => {
    // Le piège classique d’une date dérivée en UTC : 23 h locales bascule au
    // lendemain sur tous les fuseaux à l’est de Greenwich.
    const lateEvening = new Date(2026, 7, 16, 23, 45).getTime();
    expect(toLocalDate(lateEvening)).toBe('2026-08-16');
  });

  it('lève sur une date invalide plutôt que de produire un NaN silencieux', () => {
    expect(() => localMidnight('2026-02-30')).toThrow(RangeError);
  });
});
