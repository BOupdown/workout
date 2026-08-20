import { describe, expect, it } from 'vitest';
import {
  clampRestDuration,
  DEFAULT_REST_SEC,
  extendRest,
  isRestStale,
  MAX_REST_SEC,
  MIN_REST_SEC,
  parseRestTimer,
  restProgress,
  STALE_AFTER_MS,
  type RestTimer,
} from '../lib/rest-timer';

const START = 1_700_000_000_000;
const timer = (durationSec = 90, startedAt = START): RestTimer => ({ startedAt, durationSec });

describe('restProgress', () => {
  it('décompte à partir de la durée pleine', () => {
    const progress = restProgress(timer(90), START);
    expect(progress.phase).toBe('running');
    expect(progress.remainingSec).toBe(90);
    expect(progress.fraction).toBe(0);
  });

  it('garde la dernière seconde affichée pendant toute sa durée', () => {
    // À 89,5 s écoulées il reste une demi-seconde : le compteur doit encore
    // montrer 1, pas 0, sinon il annonce la fin avant qu'elle arrive.
    expect(restProgress(timer(90), START + 89_500).remainingSec).toBe(1);
  });

  it('bascule à zéro exactement à la fin', () => {
    const progress = restProgress(timer(90), START + 90_000);
    expect(progress.phase).toBe('over');
    expect(progress.remainingSec).toBe(0);
    expect(progress.fraction).toBe(1);
  });

  it('compte le dépassement une fois le repos écoulé', () => {
    const progress = restProgress(timer(90), START + 100_000);
    expect(progress.phase).toBe('over');
    expect(progress.overdueSec).toBe(10);
  });

  it('ne dépasse jamais 1 en fraction', () => {
    expect(restProgress(timer(90), START + 500_000).fraction).toBe(1);
  });

  it("traite un instant antérieur au départ comme un départ", () => {
    // Horloge système reculée pendant un repos : mieux vaut un repos entier
    // qu'un décompte négatif.
    const progress = restProgress(timer(90), START - 5_000);
    expect(progress.remainingSec).toBe(90);
    expect(progress.fraction).toBe(0);
  });

  it('survit à un écran verrouillé, puisque tout vient de l’horloge', () => {
    // Aucun tick pendant 60 s : le résultat est le même que si l’app était
    // restée au premier plan.
    expect(restProgress(timer(90), START + 60_000).remainingSec).toBe(30);
  });
});

describe('isRestStale', () => {
  it('ne périme pas un repos qui vient de finir', () => {
    expect(isRestStale(timer(90), START + 90_000 + 1_000)).toBe(false);
  });

  it('périme un repos oublié depuis longtemps', () => {
    expect(isRestStale(timer(90), START + 90_000 + STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe('extendRest', () => {
  it('sur un repos en cours, ajoute à la durée sans toucher au départ', () => {
    const extended = extendRest(timer(90), 30, START + 30_000);
    expect(extended.durationSec).toBe(120);
    expect(extended.startedAt).toBe(START);
    // 60 s restaient, il en reste 90.
    expect(restProgress(extended, START + 30_000).remainingSec).toBe(90);
  });

  it('sur un repos déjà terminé, redémarre depuis maintenant', () => {
    // Le cas qui rendait le bouton inutile : allonger la durée d'un repos
    // dépassé de 41 s ne faisait que réduire le compteur de dépassement, et ne
    // rendait aucune seconde de repos.
    const now = START + 131_000;
    const extended = extendRest(timer(90), 30, now);

    expect(extended.startedAt).toBe(now);
    expect(extended.durationSec).toBe(30);

    const progress = restProgress(extended, now);
    expect(progress.phase).toBe('running');
    expect(progress.remainingSec).toBe(30);
  });

  it('redémarre aussi un repos qui vient tout juste de finir', () => {
    const now = START + 90_000;
    expect(restProgress(extendRest(timer(90), 30, now), now).remainingSec).toBe(30);
  });

  it('ne descend pas sous le plancher', () => {
    expect(extendRest(timer(90), -1_000, START).durationSec).toBe(MIN_REST_SEC);
  });
});

describe('clampRestDuration', () => {
  it('borne des deux côtés', () => {
    expect(clampRestDuration(0)).toBe(MIN_REST_SEC);
    expect(clampRestDuration(99_999)).toBe(MAX_REST_SEC);
  });

  it('retombe sur la valeur par défaut pour un nombre invalide', () => {
    expect(clampRestDuration(Number.NaN)).toBe(DEFAULT_REST_SEC);
  });

  it('arrondit à la seconde', () => {
    expect(clampRestDuration(90.6)).toBe(91);
  });
});

describe('parseRestTimer', () => {
  it('relit ce qui a été écrit', () => {
    expect(parseRestTimer(JSON.stringify(timer(120)))).toEqual(timer(120));
  });

  it('rend null sur une clé absente', () => {
    expect(parseRestTimer(null)).toBeNull();
  });

  it('rend null sur du JSON cassé plutôt que de jeter', () => {
    // Écrit par une autre version, ou tronqué : l’écran de séance ne doit pas
    // tomber pour un minuteur.
    expect(parseRestTimer('{oops')).toBeNull();
    expect(parseRestTimer('"a string"')).toBeNull();
    expect(parseRestTimer('{"startedAt":"hier","durationSec":90}')).toBeNull();
  });

  it('borne une durée stockée aberrante', () => {
    expect(parseRestTimer('{"startedAt":1,"durationSec":999999}')?.durationSec).toBe(MAX_REST_SEC);
  });
});
