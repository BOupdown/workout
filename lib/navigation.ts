/**
 * Tab order, in one place.
 *
 * The carousel lays the screens out in this order and the tab bar draws them in
 * the same one, so scrolling right can only ever land on the tab drawn to the
 * right.
 */
export const TABS = ['Session', 'History', 'Progress', 'Settings'] as const;

export type TabLabel = (typeof TABS)[number];
