import { describe, expect, it } from 'vitest';
import {
  isJoinedWithNext,
  lastOfGroup,
  nextInGroup,
  toggleJoinWithNext,
  type GroupedBlock,
} from '../lib/superset';

/** Blocks in session order, with optional groups: 'a0' = block a, group 0. */
const blocks = (...spec: string[]): GroupedBlock[] =>
  spec.map((entry, index) => ({
    id: entry[0],
    order: index,
    ...(entry.length > 1 ? { supersetGroup: Number(entry.slice(1)) } : {}),
  }));

/** Applies the changes, so assertions read as the resulting layout. */
function apply(source: GroupedBlock[], blockId: string): GroupedBlock[] {
  const changes = toggleJoinWithNext(source, blockId);
  if (changes === null) return source;

  const byId = new Map(changes.map((change) => [change.id, change.supersetGroup]));
  return source.map((block) =>
    byId.has(block.id)
      ? (() => {
          const group = byId.get(block.id);
          const next: GroupedBlock = { id: block.id, order: block.order };
          if (group !== undefined) next.supersetGroup = group;
          return next;
        })()
      : block,
  );
}

const groupsOf = (layout: GroupedBlock[]) =>
  layout.map((block) => `${block.id}${block.supersetGroup ?? ''}`).join(',');

describe('toggleJoinWithNext', () => {
  it('joint deux exercices voisins', () => {
    expect(groupsOf(apply(blocks('a', 'b', 'c'), 'a'))).toBe('a0,b0,c');
  });

  it('sépare deux exercices déjà joints', () => {
    // Il ne reste qu'un membre de chaque côté : plus aucun superset.
    expect(groupsOf(apply(blocks('a0', 'b0', 'c'), 'a'))).toBe('a,b,c');
  });

  it('étend un superset au voisin suivant', () => {
    expect(groupsOf(apply(blocks('a0', 'b0', 'c'), 'b'))).toBe('a0,b0,c0');
  });

  it('fusionne deux supersets en un seul', () => {
    // Joindre la queue de l'un à la tête de l'autre ne peut pas produire un
    // groupe à trou : les quatre n'en font qu'un.
    const layout = apply(blocks('a0', 'b0', 'c1', 'd1'), 'b');
    const groups = new Set(layout.map((block) => block.supersetGroup));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTypeOf('number');
  });

  it('détache la queue d’un groupe de trois', () => {
    // a|b,c : a se retrouve seul donc sans groupe, b et c gardent un superset.
    const layout = apply(blocks('a0', 'b0', 'c0'), 'a');
    expect(layout[0].supersetGroup).toBeUndefined();
    expect(layout[1].supersetGroup).toBe(layout[2].supersetGroup);
    expect(layout[1].supersetGroup).toBeTypeOf('number');
  });

  it('coupe au milieu d’un groupe de quatre', () => {
    const layout = apply(blocks('a0', 'b0', 'c0', 'd0'), 'b');
    expect(layout[0].supersetGroup).toBe(layout[1].supersetGroup);
    expect(layout[2].supersetGroup).toBe(layout[3].supersetGroup);
    expect(layout[0].supersetGroup).not.toBe(layout[2].supersetGroup);
  });

  it('ne laisse jamais un groupe d’un seul membre', () => {
    // Un superset d'un exercice est un exercice : laisser le numéro le ferait
    // passer pour autre chose.
    const layout = apply(blocks('a0', 'b0'), 'a');
    expect(layout.every((block) => block.supersetGroup === undefined)).toBe(true);
  });

  it('ne rend rien pour le dernier exercice', () => {
    expect(toggleJoinWithNext(blocks('a', 'b'), 'b')).toBeNull();
  });

  it('ne rend rien pour un identifiant inconnu', () => {
    expect(toggleJoinWithNext(blocks('a', 'b'), 'zzz')).toBeNull();
  });

  it('ne renvoie que les blocs réellement modifiés', () => {
    const changes = toggleJoinWithNext(blocks('a', 'b', 'c'), 'a');
    expect(changes?.map((change) => change.id).sort()).toEqual(['a', 'b']);
  });

  it('est réversible', () => {
    const joined = apply(blocks('a', 'b', 'c'), 'a');
    expect(groupsOf(apply(joined, 'a'))).toBe('a,b,c');
  });

  it('ignore l’ordre d’arrivée de la liste', () => {
    const shuffled = [...blocks('a', 'b', 'c')].reverse();
    expect(groupsOf(apply(shuffled, 'a').sort((x, y) => x.order - y.order))).toBe('a0,b0,c');
  });

  it('n’écrase pas un groupe existant ailleurs', () => {
    // c et d gardent le leur, et le nouveau groupe prend un numéro libre.
    const layout = apply(blocks('a', 'b', 'c1', 'd1'), 'a');
    expect(layout[2].supersetGroup).toBe(1);
    expect(layout[3].supersetGroup).toBe(1);
    expect(layout[0].supersetGroup).not.toBe(1);
    expect(layout[0].supersetGroup).toBe(layout[1].supersetGroup);
  });
});

describe('isJoinedWithNext', () => {
  it('reconnaît deux voisins du même groupe', () => {
    expect(isJoinedWithNext(blocks('a0', 'b0'), 'a')).toBe(true);
  });

  it('refuse deux voisins de groupes différents', () => {
    expect(isJoinedWithNext(blocks('a0', 'b1'), 'a')).toBe(false);
  });

  it('refuse le dernier exercice', () => {
    expect(isJoinedWithNext(blocks('a0', 'b0'), 'b')).toBe(false);
  });
});

describe('lastOfGroup', () => {
  it('rend le bloc lui-même hors superset', () => {
    expect(lastOfGroup(blocks('a', 'b'), 'a')).toBe('a');
  });

  it('rend le dernier membre du superset', () => {
    expect(lastOfGroup(blocks('a0', 'b0', 'c0'), 'a')).toBe('c');
  });

  it('ne déborde pas sur un groupe voisin', () => {
    expect(lastOfGroup(blocks('a0', 'b0', 'c1', 'd1'), 'a')).toBe('b');
  });
});

describe('nextInGroup', () => {
  it('rend null hors superset : le tap unique doit continuer de répéter', () => {
    expect(nextInGroup(blocks('a', 'b'), 'a')).toBeNull();
  });

  it('avance au membre suivant', () => {
    expect(nextInGroup(blocks('a0', 'b0', 'c0'), 'a')).toBe('b');
  });

  it('revient au premier une fois le tour bouclé', () => {
    // C'est ce que fait un superset : on enchaîne les tours.
    expect(nextInGroup(blocks('a0', 'b0', 'c0'), 'c')).toBe('a');
  });
});

describe('contiguïté vérifiée à la lecture', () => {
  // Un réordonnancement peut glisser un exercice entre deux membres d'un
  // superset. Le numéro stocké dit encore « même groupe », mais ils ne sont
  // plus enchaînés — et c'est l'écran qui a raison.
  const broken = () => blocks('a0', 'c', 'b0');

  it('ne relie plus deux membres séparés par un intrus', () => {
    expect(isJoinedWithNext(broken(), 'a')).toBe(false);
  });

  it('ne fait plus avancer la saisie par-dessus l’intrus', () => {
    expect(nextInGroup(broken(), 'a')).toBeNull();
  });

  it('rend le bloc à lui-même pour le repos', () => {
    // Sinon le repos attendrait un « dernier membre » qu'on n'atteindra jamais.
    expect(lastOfGroup(broken(), 'a')).toBe('a');
  });

  it('garde le superset intact tant que la suite est contiguë', () => {
    const intact = blocks('a0', 'b0', 'c');
    expect(isJoinedWithNext(intact, 'a')).toBe(true);
    expect(nextInGroup(intact, 'a')).toBe('b');
    expect(lastOfGroup(intact, 'a')).toBe('b');
  });
});
