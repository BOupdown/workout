/**
 * Turns data-layer errors into displayable messages.
 *
 * No raw exception should ever reach the screen. `ValidationError` already
 * carries written messages and a `field`; all that remains is routing them to
 * the right input.
 */

import { ValidationError } from './db/validation';

export interface FieldMessages {
  /** Message shown under each field, at most one per field. */
  fields: Record<string, string>;
  /** Anything tied to no visible field - a banner at the top of the panel. */
  general: string[];
}

export const NO_MESSAGES: FieldMessages = { fields: {}, general: [] };

const UNEXPECTED = 'Could not save the set. Try again.';

/**
 * @param visibleFields the fields the form actually renders. An issue about a
 *   field absent from the screen (`sessionId`, `loggedAt`…) is surfaced as a
 *   general message rather than attached to an invisible input, where nobody
 *   would ever see it.
 */
export function toFieldMessages(
  error: unknown,
  visibleFields: readonly string[] = [],
): FieldMessages {
  if (error instanceof ValidationError) {
    const fields: Record<string, string> = {};
    const general: string[] = [];

    for (const issue of error.issues) {
      if (!visibleFields.includes(issue.field)) {
        general.push(issue.message);
      } else if (!(issue.field in fields)) {
        // First message per field: beyond that, it is just noise under an input.
        fields[issue.field] = issue.message;
      }
    }

    return { fields, general };
  }

  if (error instanceof Error) {
    return { fields: {}, general: [error.message] };
  }

  return { fields: {}, general: [UNEXPECTED] };
}

export function hasMessages(messages: FieldMessages): boolean {
  return messages.general.length > 0 || Object.keys(messages.fields).length > 0;
}
