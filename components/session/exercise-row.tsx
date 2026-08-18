'use client';

import { describeSet } from '@/lib/format';
import type { Exercise, SessionExerciseWithSets, SetEntry } from '@/lib/db/types';

interface ExerciseRowProps {
  entry: SessionExerciseWithSets;
  isActive: boolean;
  onSelect: () => void;
  /** Série tout juste enregistrée, à faire apparaître. */
  justLoggedSetId?: string;
}

/**
 * Un exercice de la séance et ses séries.
 *
 * Les séries sont posées en tuiles plutôt qu'en ligne de texte : la valeur qui
 * progresse est le contenu de cet écran, elle doit se lire d'un coup d'œil,
 * bras tendu, entre deux séries. L'échauffement est en retrait sans disparaître.
 *
 * L'exercice actif se signale par une barre d'accent et un fond teinté, pas par
 * une inversion complète : inverser écrasait la lisibilité des chiffres.
 */
export function ExerciseRow({ entry, isActive, onSelect, justLoggedSetId }: ExerciseRowProps) {
  const { exercise, sets } = entry;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={`relative w-full overflow-hidden rounded-panel border px-4 py-3.5 text-left transition-transform active:scale-[0.99] ${
        isActive ? 'border-accent bg-accent-wash' : 'border-transparent bg-raised'
      }`}
    >
      {isActive ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-accent" />
      ) : null}

      <div className="flex min-h-6 items-baseline justify-between gap-3">
        <span className="truncate text-[0.9375rem] font-semibold text-ink">{exercise.name}</span>
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          {sets.length > 0 ? `${sets.length} ×` : 'à faire'}
        </span>
      </div>

      {sets.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {sets.map((set) => (
            <SetTile
              key={set.id}
              set={set}
              exercise={exercise}
              isActive={isActive}
              justLogged={set.id === justLoggedSetId}
            />
          ))}
        </ul>
      ) : null}
    </button>
  );
}

function SetTile({
  set,
  exercise,
  isActive,
  justLogged,
}: {
  set: SetEntry;
  exercise: Exercise;
  isActive: boolean;
  justLogged: boolean;
}) {
  const { primary, secondary } = describeSet(set, exercise);
  const isWarmup = set.kind === 'warmup';

  // Sur la ligne active le fond est déjà teinté : les tuiles passent en blanc
  // pour rester détachées, au lieu de se fondre dedans.
  const background = isActive ? 'bg-raised' : 'bg-surface';

  return (
    <li
      className={`flex items-baseline gap-1 rounded-control px-2.5 py-1.5 font-mono tabular-nums ${background} ${
        isWarmup ? 'text-muted' : 'text-ink'
      } ${justLogged ? 'animate-set-logged' : ''}`}
    >
      <span className={isWarmup ? 'text-sm' : 'text-base font-semibold'}>{primary}</span>
      {secondary ? <span className="text-xs text-muted">{secondary}</span> : null}
      {isWarmup ? <span className="sr-only">(échauffement)</span> : null}
    </li>
  );
}
