'use client';

import { useSwipeNavigation } from '@/hooks/use-swipe-navigation';

/**
 * Mounts the swipe gesture. Renders nothing: the listeners live on `document`,
 * so no wrapper element is added and the layout is untouched.
 */
export function SwipeNavigator() {
  useSwipeNavigation();
  return null;
}
