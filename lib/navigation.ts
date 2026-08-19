/**
 * Tab order, in one place.
 *
 * Both the tab bar and the swipe gesture read it, so the visual order and the
 * gesture order cannot drift apart — swiping left must always land on the tab
 * drawn to the right.
 */
export const TAB_ORDER = ['/', '/history', '/progress', '/settings'] as const;

export type TabHref = (typeof TAB_ORDER)[number];

/** Index of the tab a pathname belongs to, or `-1` when it is none of them. */
export function tabIndexFor(pathname: string): number {
  return TAB_ORDER.findIndex((href) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href),
  );
}
