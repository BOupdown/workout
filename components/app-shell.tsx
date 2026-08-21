'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryScreen } from '@/components/history/history-screen';
import { TabBar } from '@/components/nav/tab-bar';
import { ExerciseIndexScreen } from '@/components/progression/exercise-index-screen';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import { SettingsScreen } from '@/components/settings/settings-screen';
import { ActiveSessionScreen } from '@/components/session/active-session-screen';
import { TABS } from '@/lib/navigation';

/**
 * The four tabs, laid side by side on one horizontally scrolling track.
 *
 * The gesture is the browser's own scrolling, not a reimplementation: the
 * content follows the finger with system physics, and a hesitant swipe snaps
 * back on its own. That is safer than a distance threshold, which commits or
 * does nothing with no feedback in between — a real risk in this app, where a
 * thumb repeatedly hits "Save set" mid-set.
 *
 * The price is that all four screens stay mounted, so their live queries all
 * run. On a database this size that is cheap, and it buys instant switching
 * with no loading state.
 *
 * One route rather than four: the URL no longer names the tab, which is
 * invisible in an installed app with no address bar, and it is what lets the
 * track keep scrolling without React unmounting anything underneath.
 */
export function AppShell() {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const scrollToTab = useCallback((index: number) => {
    const element = track.current;
    if (!element) return;

    element.scrollTo({ left: index * element.clientWidth, behavior: 'smooth' });
    // Set immediately so the tab bar answers the tap, rather than waiting for
    // the smooth scroll to finish.
    setActive(index);
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!element) return;

    // `scrollend` is not available everywhere; a short debounce covers the rest
    // and costs nothing where it is.
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      const index = Math.round(element.scrollLeft / element.clientWidth);
      setActive(Math.min(Math.max(index, 0), TABS.length - 1));
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 90);
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('scrollend', settle);

    return () => {
      clearTimeout(timer);
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('scrollend', settle);
    };
  }, []);

  return (
    /* Framed rather than stretched. The whole layout is drawn for a thumb at
       375px; letting it fill a 1440px monitor put a 1300px-wide "Save set"
       button on screen, which reads as unfinished rather than as a phone app.
       The side rules only appear once there is room for them. */
    <div className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col border-line sm:border-x">
      <div
        ref={track}
        // `overscroll-x-contain` stops a swipe past the last tab from triggering
        // the browser's own back gesture.
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none"
      >
        <section className="h-full w-full shrink-0 snap-center" aria-label="Session">
          <ActiveSessionScreen />
        </section>
        <section className="h-full w-full shrink-0 snap-center" aria-label="History">
          <HistoryScreen />
        </section>
        <section className="h-full w-full shrink-0 snap-center" aria-label="Progress">
          <ExerciseIndexScreen />
        </section>
        <section className="h-full w-full shrink-0 snap-center" aria-label="Settings">
          <SettingsScreen />
        </section>
      </div>

      <ServiceWorkerRegistrar />
      <TabBar active={active} onSelect={scrollToTab} />
    </div>
  );
}
