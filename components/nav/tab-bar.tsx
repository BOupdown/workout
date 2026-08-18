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
  { href: '/', label: 'Séance', icon: Barbell },
  { href: '/historique', label: 'Historique', icon: ClockCounterClockwise },
  { href: '/progression', label: 'Progression', icon: ChartLineUp },
  { href: '/reglages', label: 'Réglages', icon: SlidersHorizontal },
];

/**
 * Navigation principale, en bas dans la portée du pouce.
 *
 * Quatre onglets, quatre destinations réelles : pas d'entrée décorative qui
 * mènerait à un écran vide. L'accent porte le glyphe de l'onglet actif au lieu
 * de le colorer — à sa luminance, une icône verte sur fond clair disparaîtrait.
 */
export function TabBar() {
  const pathname = usePathname();
  const activeSession = useLiveQuery(() => getActiveSession(), []);

  return (
    <nav
      aria-label="Navigation principale"
      className="shrink-0 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {TABS.map(({ href, label, icon: TabIcon }) => {
          const isCurrent = href === '/' ? pathname === '/' : pathname.startsWith(href);
          // Pastille sémantique : elle signale une séance réellement en cours,
          // ce n'est pas une décoration.
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
