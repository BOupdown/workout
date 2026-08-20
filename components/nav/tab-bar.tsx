'use client';

import {
  Barbell,
  ChartLineUp,
  ClockCounterClockwise,
  SlidersHorizontal,
  type Icon,
} from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveSession } from '@/lib/db/sessions';
import { TABS, type TabLabel } from '@/lib/navigation';

const ICONS: Record<TabLabel, Icon> = {
  Session: Barbell,
  History: ClockCounterClockwise,
  Progress: ChartLineUp,
  Settings: SlidersHorizontal,
};

interface TabBarProps {
  active: number;
  onSelect: (index: number) => void;
}

/**
 * Main navigation, at the bottom within thumb reach.
 *
 * Buttons rather than links: tapping scrolls the same track the finger swipes,
 * so a tap and a swipe end in exactly the same place by exactly the same means.
 *
 * The accent carries the active tab's glyph rather than colouring it - at that
 * lightness, a green icon on a light background would vanish.
 */
export function TabBar({ active, onSelect }: TabBarProps) {
  const activeSession = useLiveQuery(() => getActiveSession(), []);

  return (
    <nav
      aria-label="Main navigation"
      className="shrink-0 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {TABS.map((label, index) => {
          const TabIcon = ICONS[label];
          const isCurrent = index === active;
          // A semantic dot: it signals a session actually in progress, it is
          // not decoration.
          const showDot = index === 0 && activeSession !== undefined && activeSession !== null;

          return (
            <li key={label} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={isCurrent ? 'page' : undefined}
                className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 py-1.5 transition-transform active:scale-95"
              >
                <span
                  className={`relative flex h-7 w-12 items-center justify-center rounded-full ${
                    isCurrent ? 'bg-accent text-accent-ink' : 'text-muted'
                  }`}
                >
                  <TabIcon size={19} weight={isCurrent ? 'fill' : 'regular'} />
                  {showDot && !isCurrent ? (
                    <span className="absolute top-0.5 right-2.5 h-1.5 w-1.5 rounded-full bg-accent" />
                  ) : null}
                </span>
                <span
                  className={`text-[0.6875rem] ${
                    isCurrent ? 'font-semibold text-ink' : 'text-muted'
                  }`}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
