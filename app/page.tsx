import { ViewTransition } from 'react';
import { ActiveSessionScreen } from '@/components/session/active-session-screen';

/**
 * The directional slide is driven by the transition type the swipe gesture
 * emits. `default: 'none'` keeps untyped navigations - a tab tap, a browser
 * back, a Suspense reveal - from sliding in an arbitrary direction.
 *
 * The wrapper lives in the page, not the layout: layouts persist across
 * navigations, so enter and exit would never fire there.
 */
export default function Home() {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      default="none"
    >
      <ActiveSessionScreen />
    </ViewTransition>
  );
}
