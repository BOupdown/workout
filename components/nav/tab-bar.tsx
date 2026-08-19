'use client';

import {
  Barbell,
  ChartLineUp,
  ClockCounterClockwise,
  SlidersHorizontal,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveSession } from '@/lib/db/sessions';

interface Tab {
  href: string;
  label: string;
  icon: Icon;
}

const TABS: Tab[] = [
  { href: '/', label: 'Session', icon: Barbell },
  { href: '/history', label: 'History', icon: ClockCounterClockwise },
  { href: '/progress', label: 'Progress', icon: ChartLineUp },
  { href: '/settings', label: 'Settings', icon: SlidersHorizontal },
];

/**
 * Main navigation, at the bottom within thumb reach.
 *
 * Four tabs, four real destinations: no decorative entry leading to an empty
 * screen. The accent carries the active tab's glyph rather than colouring it -
 * at that lightness, a green icon on a light background would vanish.
 */
export function TabBar() {
  const pathname = usePathname();
  const activeSession = useLiveQuery(() => getActiveSession(), []);

  return (
    <nav
      aria-label="Main navigation"
      className="shrink-0 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {TABS.map(({ href, label, icon: TabIcon }) => {
          const isCurrent = href === '/' ? pathname === '/' : pathname.startsWith(href);
          // A semantic dot: it signals a session actually in progress, it is
          // not decoration.
          const showDot = href === '/' && activeSession !== undefined && activeSession !== null;

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isCurrent ? 'page' : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 transition-transform active:scale-95"
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
