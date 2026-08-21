/**
 * Turning past sessions into a list worth choosing from.
 *
 * Repeating *the last* session is the wrong offer for anyone training on a
 * split: Push, Pull, Legs, and the one you want back is almost never the one
 * you just did. What is needed is to pick which layout to reopen — which is
 * exactly what naming a session was for.
 */

import type { Id, SessionSummary, Timestamp } from './db/types';

/** A past session offered as a layout to reopen. */
export interface SessionTemplate {
  sessionId: Id;
  /** The name the user gave it. Absent sessions are shown by their day. */
  title?: string;
  performedAt: Timestamp;
  exerciseNames: string[];
}

/** How many to offer. Long enough to hold a full split, short enough to scan. */
export const MAX_TEMPLATES = 12;

/**
 * Titles are matched loosely on purpose: "Push A" and "push a " are the same
 * routine to the person who typed them, and showing both would defeat the
 * grouping. Deliberately *not* `toNameKey`, which also strips accents and
 * punctuation to settle exercise identity — a session title is free text, and
 * flattening it that far would merge routines that read differently.
 */
const titleKey = (title: string) => title.trim().toLowerCase();

/**
 * The layouts on offer, most recent first.
 *
 * A named routine appears **once**, at its most recent outing: someone who has
 * done Push A eleven times wants one entry, not eleven. Unnamed sessions stay
 * individual, because nothing says two of them are the same routine — and a
 * date is all there is to tell them apart.
 *
 * Sessions with no exercise are dropped: there is no layout to reopen.
 */
export function sessionTemplates(
  summaries: SessionSummary[],
  limit = MAX_TEMPLATES,
): SessionTemplate[] {
  const byRecency = [...summaries].sort((a, b) => b.startedAt - a.startedAt);

  const templates: SessionTemplate[] = [];
  const seenTitles = new Set<string>();

  for (const summary of byRecency) {
    if (summary.exerciseCount === 0) continue;

    if (summary.title !== undefined) {
      const key = titleKey(summary.title);
      // Empty once trimmed: treat it as unnamed rather than grouping every
      // whitespace-only title together.
      if (key !== '') {
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
      }
    }

    templates.push({
      sessionId: summary.id,
      ...(summary.title !== undefined ? { title: summary.title } : {}),
      performedAt: summary.startedAt,
      exerciseNames: summary.exerciseNames,
    });

    if (templates.length === limit) break;
  }

  return templates;
}
