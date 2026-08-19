'use client';

import { addTransitionType } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';
import { TAB_ORDER, tabIndexFor } from '@/lib/navigation';

/**
 * Thresholds. They are deliberately demanding.
 *
 * This app is used one-handed, mid-set, with a thumb repeatedly hitting "Save
 * set". A lax swipe would throw someone off their session by accident, which is
 * far worse than having to swipe a little more decisively. So the gesture must
 * be long, mostly horizontal, and quick.
 */
const MIN_DISTANCE = 70;
/** Horizontal travel must dominate, or a diagonal scroll would navigate. */
const DIRECTION_RATIO = 1.5;
const MAX_DURATION = 700;
/**
 * iOS reserves the left edge for its own back gesture. Starting a swipe there
 * would fight the system, and the system wins.
 */
const EDGE_GUARD = 28;

interface Gesture {
  x: number;
  y: number;
  at: number;
}

/**
 * Swipe left or right to move between tabs.
 *
 * Listeners sit on `document` rather than a wrapper element: no extra DOM node,
 * so nothing about the layout can break. They are passive — `preventDefault` is
 * never called, so vertical scrolling stays untouched.
 *
 * Anything inside `[data-no-swipe]` is excluded: the entry panel, where a
 * horizontal drag means adjusting a value, and every full-screen sheet, where
 * changing the tab underneath would be nonsense.
 */
export function useSwipeNavigation(): void {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let start: Gesture | null = null;

    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];
      if (touch.clientX < EDGE_GUARD) return;

      const target = event.target;
      if (target instanceof Element && target.closest('[data-no-swipe]')) return;

      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    };

    const onTouchEnd = (event: TouchEvent) => {
      const from = start;
      start = null;
      if (!from || event.changedTouches.length !== 1) return;

      const touch = event.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;

      if (Date.now() - from.at > MAX_DURATION) return;
      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;

      const current = tabIndexFor(pathname);
      if (current === -1) return;

      // Swiping left pulls the next tab in from the right, like turning a page.
      const next = current + (dx < 0 ? 1 : -1);
      if (next < 0 || next >= TAB_ORDER.length) return;

      startTransition(() => {
        // Tells the view transition which way to slide. Without a type the
        // pages cross-fade with no direction, which reads as a glitch.
        addTransitionType(dx < 0 ? 'nav-forward' : 'nav-back');
        router.push(TAB_ORDER[next]);
      });
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [router, pathname]);
}
