/**
 * The rules every task-catalog store keeps, so the memory and file adapters cannot drift apart: one
 * offer per dedupe key, a decision that only the person's own choice changes, offers that read as
 * expired once their time has passed, and a published definition revision that never changes.
 */
import { TaskCatalogRefusedError, oneOf } from './fields.js';
import { OFFER_DECISIONS } from './types.js';

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
 * Put an offer among the stored ones. What arrives is an observation, so it never chooses what the
 * person decided: a new offer is stored open whatever it claims, and an offer whose dedupe key is
 * already stored (under any id, the same one included) is not added again. It updates that offer's
 * evidence (revision, reason, context, suggestions and expiry) and leaves its id, source, creation time
 * and decision as they were, so a repeat observation cannot reopen a dismissed or accepted offer. A
 * lapsed offer that was recorded as expired returns to open only when the repeat has a later expiry.
 */
export function putOfferInto(
  offers: readonly IOffer[],
  offer: IOffer,
): { readonly offers: readonly IOffer[]; readonly stored: IOffer } {
  const kept = offers.find((entry) => entry.dedupeKey === offer.dedupeKey);
  if (kept === undefined) {
    if (offers.some((entry) => entry.id === offer.id))
      throw new TaskCatalogRefusedError('Another offer already has this id');
    if (offers.length >= MAX_OFFERS)
      throw new TaskCatalogRefusedError(`At most ${MAX_OFFERS} offers are kept`);
    const stored: IOffer = { ...offer, decision: 'open' };
    return { offers: [...offers, stored], stored };
  }
  if (offer.definitionId !== kept.definitionId)
    throw new TaskCatalogRefusedError(
      'A repeat observation cannot change which task an offer is for',
    );
  if (Date.parse(offer.expiresAt) <= Date.parse(kept.createdAt))
    throw new TaskCatalogRefusedError('expiresAt must be after the offer was first made');
  const { prefilled: _earlier, ...rest } = kept;
  const later = Date.parse(offer.expiresAt) > Date.parse(kept.expiresAt);
  const stored: IOffer = {
    ...rest,
    definitionRevision: offer.definitionRevision,
    reason: offer.reason,
    contextRefs: offer.contextRefs,
    expiresAt: offer.expiresAt,
    decision: kept.decision === 'expired' && later ? 'open' : kept.decision,
    ...(offer.prefilled !== undefined && { prefilled: offer.prefilled }),
  };
  return { offers: offers.map((entry) => (entry === kept ? stored : entry)), stored };
}

/**
 * Record the person's decision about an offer. It is the only way a decision changes after the offer
 * is stored, and what it is given has to be a decision of an offer that is kept.
 */
export function setDecisionIn(
  offers: readonly IOffer[],
  id: string,
  decision: unknown,
): { readonly offers: readonly IOffer[]; readonly stored: IOffer } {
  const chosen = oneOf(decision, 'decision', OFFER_DECISIONS);
  const kept = offers.find((entry) => entry.id === id);
  if (kept === undefined) throw new TaskCatalogRefusedError(`No offer ${id}`);
  const stored: IOffer = { ...kept, decision: chosen };
  return { offers: offers.map((entry) => (entry === kept ? stored : entry)), stored };
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
