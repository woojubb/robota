/**
 * The rules every task-catalog store keeps, so the memory and file adapters cannot drift apart: one
 * offer per dedupe key, offers read as expired once their time has passed, and a published definition
 * revision that never changes.
 */
import { TaskCatalogRefusedError } from './fields.js';

import type { IOffer, ITaskDefinition } from './types.js';

export const MAX_OFFERS = 500;
export const MAX_DEFINITIONS = 200;

/** An open offer past its expiry reads as expired; any other decision reads as recorded. */
export function readOffer(offer: IOffer, now: Date): IOffer {
  return offer.decision === 'open' && Date.parse(offer.expiresAt) <= now.getTime()
    ? { ...offer, decision: 'expired' }
    : offer;
}

/**
 * Put an offer among the stored ones. The same id replaces that record. A different id with a key that
 * is already stored never adds a copy: it updates the stored offer's reason, context and expiry, and
 * leaves who it is, when it was made and what the person decided about it as they were, so a repeat
 * observation cannot reopen a dismissed or accepted offer.
 */
export function putOfferInto(
  offers: readonly IOffer[],
  offer: IOffer,
): { readonly offers: readonly IOffer[]; readonly stored: IOffer } {
  const sameKey = offers.find((entry) => entry.dedupeKey === offer.dedupeKey);
  const sameId = offers.find((entry) => entry.id === offer.id);
  if (sameKey !== undefined && sameKey.id !== offer.id) {
    if (sameId !== undefined)
      throw new TaskCatalogRefusedError('Another offer already has this dedupe key');
    const stored: IOffer = {
      ...offer,
      id: sameKey.id,
      createdAt: sameKey.createdAt,
      decision: sameKey.decision === 'expired' ? offer.decision : sameKey.decision,
    };
    return { offers: offers.map((entry) => (entry === sameKey ? stored : entry)), stored };
  }
  if (sameId === undefined && offers.length >= MAX_OFFERS)
    throw new TaskCatalogRefusedError(`At most ${MAX_OFFERS} offers are kept`);
  return {
    offers:
      sameId === undefined ? [...offers, offer] : offers.map((e) => (e === sameId ? offer : e)),
    stored: offer,
  };
}

/** Put a definition revision among the stored ones; a revision already stored cannot be changed. */
export function putDefinitionInto(
  definitions: readonly ITaskDefinition[],
  definition: ITaskDefinition,
): readonly ITaskDefinition[] {
  const same = definitions.find(
    (entry) => entry.id === definition.id && entry.revision === definition.revision,
  );
  if (same !== undefined) {
    if (JSON.stringify(same) !== JSON.stringify(definition))
      throw new TaskCatalogRefusedError(
        'A published revision does not change; give the change a new revision',
      );
    return definitions;
  }
  if (definitions.length >= MAX_DEFINITIONS)
    throw new TaskCatalogRefusedError(`At most ${MAX_DEFINITIONS} task definitions are kept`);
  return [...definitions, definition];
}
