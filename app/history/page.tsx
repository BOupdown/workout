import { ViewTransition } from 'react';
import { HistoryScreen } from '@/components/history/history-screen';

/**
 * The directional slide is driven by the transition type the swipe gesture
 * emits. `default: 'none'` keeps untyped navigations - a tab tap, a browser
 * back, a Suspense reveal - from sliding in an arbitrary direction.
 *
 * The wrapper lives in the page, not the layout: layouts persist across
 * navigations, so enter and exit would never fire there.
 */
export default function HistoryPage() {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      default="none"
    >
      <HistoryScreen />
    </ViewTransition>
  );
}
