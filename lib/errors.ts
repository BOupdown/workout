/**
 * Traduction des erreurs de la couche de données en messages affichables.
 *
 * Aucune exception brute ne doit atteindre l'écran. Les `ValidationError`
 * portent déjà des messages rédigés et un `field` ; il ne reste qu'à les router
 * vers le bon input.
 */

import { ValidationError } from './db/validation';

export interface FieldMessages {
  /** Message à afficher sous chaque champ, au plus un par champ. */
  fields: Record<string, string>;
  /** Ce qui ne se rattache à aucun champ visible — bandeau en tête de panneau. */
  general: string[];
}

export const NO_MESSAGES: FieldMessages = { fields: {}, general: [] };

const UNEXPECTED = 'Impossible d’enregistrer la série. Réessayez.';

/**
 * @param visibleFields champs réellement rendus par le formulaire. Une anomalie
 *   portant sur un champ absent de l'écran (`sessionId`, `loggedAt`…) est
 *   remontée en message général plutôt qu'attachée à un input invisible, où
 *   personne ne la verrait jamais.
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
        // Premier message par champ : au-delà, on empile du bruit sous un input.
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
