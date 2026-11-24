/**
 * The rules every task-catalog store keeps, so the memory and file adapters cannot drift apart: one
 * offer per dedupe key, a decision that only the person's own choice changes, offers that read as
 * expired once their time has passed and as open once a snooze has ended, reactions that are recorded
 * once, and a published definition revision that never changes.
 */
import { TaskCatalogRefusedError, isoTime, oneOf } from './fields.js';
import { OFFER_DECISIONS } from './types.js';

import type { TOutcomeState } from './launch/types.js';
import type { IOffer, IOfferReactions, ITaskDefinition } from './types.js';

export const MAX_OFFERS = 500;
export const MAX_DEFINITIONS = 200;
/**
 * How long a finished offer (dismissed, accepted or lapsed) is kept before a full store may drop it to
 * make room. Until then it still remembers what the person decided about its source matter.
 */
export const FINISHED_OFFER_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * An offer as it reads at `now`: a snoozed one whose time has come is open again, and an open or
 * snoozed one past its expiry reads as expired. Any other decision reads as recorded. The stored
 * record is never changed by reading, so a restart reads the same answer from the same clock.
 */
export function readOffer(offer: IOffer, now: Date): IOffer {
  let current = offer;
  if (current.decision === 'snoozed' && Date.parse(current.snoozedUntil!) <= now.getTime()) {
    const { snoozedUntil: _until, ...awake } = current;
    current = { ...awake, decision: 'open' };
  }
  return (current.decision === 'open' || current.decision === 'snoozed') &&
    Date.parse(current.expiresAt) <= now.getTime()
    ? { ...current, decision: 'expired' }
    : current;
}

/** The reactions with one time set; a time that happens once keeps the first, one that can repeat keeps the last. */
function stamped(
  reactions: IOfferReactions | undefined,
  name: Exclude<keyof IOfferReactions, 'outcome'>,
  at: string,
  latest = false,
): IOfferReactions {
  return latest || reactions?.[name] === undefined
    ? { ...reactions, [name]: at }
    : (reactions ?? {});
}

/** Finished: decided, or still undecided with its time gone by `at`. */
const isFinished = (offer: IOffer, at: string): boolean =>
  offer.decision === 'dismissed' ||
  offer.decision === 'accepted' ||
  offer.decision === 'superseded' ||
  offer.decision === 'expired' ||
  Date.parse(offer.expiresAt) <= Date.parse(at);

/** Drop the oldest finished offer that is old enough, and refuse when none is: nothing open is ever dropped. */
function makeRoom(offers: readonly IOffer[], at: string): readonly IOffer[] {
  const cutoff = Date.parse(at) - FINISHED_OFFER_KEPT_MS;
  const droppable = offers
    .filter((entry) => isFinished(entry, at) && Date.parse(entry.createdAt) <= cutoff)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (droppable.length === 0)
    throw new TaskCatalogRefusedError(`At most ${MAX_OFFERS} offers are kept`);
  return offers.filter((entry) => entry !== droppable[0]);
}

/**
 * Put an offer among the stored ones. What arrives is an observation, so it never chooses what the
 * person decided: a new offer is stored open whatever it claims, and an offer whose dedupe key is
 * already stored (under any id, the same one included) is not added again. It updates that offer's
 * evidence (revision, reason, basis, what it was read from, context, suggestions and expiry) and leaves
 * its id, source, creation time, decision, snooze, launch and reactions as they were, so a repeat
 * observation cannot reopen a dismissed or accepted offer or wake a snoozed one. A lapsed offer that
 * was recorded as expired returns to open only when the repeat has a later expiry. A full store makes
 * room for a new offer only by dropping a finished one that is old enough.
 */
export function putOfferInto(
  offers: readonly IOffer[],
  offer: IOffer,
): { readonly offers: readonly IOffer[]; readonly stored: IOffer } {
  const kept = offers.find((entry) => entry.dedupeKey === offer.dedupeKey);
  if (kept === undefined) {
    if (offers.some((entry) => entry.id === offer.id))
      throw new TaskCatalogRefusedError('Another offer already has this id');
    const room = offers.length < MAX_OFFERS ? offers : makeRoom(offers, offer.createdAt);
    const stored: IOffer = { ...offer, decision: 'open' };
    return { offers: [...room, stored], stored };
  }
  if (offer.definitionId !== kept.definitionId)
    throw new TaskCatalogRefusedError(
      'A repeat observation cannot change which task an offer is for',
    );
  if (Date.parse(offer.expiresAt) <= Date.parse(kept.createdAt))
    throw new TaskCatalogRefusedError('expiresAt must be after the offer was first made');
  const { prefilled: _earlier, basis: _basis, evidence: _evidence, ...rest } = kept;
  const later = Date.parse(offer.expiresAt) > Date.parse(kept.expiresAt);
  const stored: IOffer = {
    ...rest,
    definitionRevision: offer.definitionRevision,
    reason: offer.reason,
    contextRefs: offer.contextRefs,
    expiresAt: offer.expiresAt,
    decision: kept.decision === 'expired' && later ? 'open' : kept.decision,
    ...(offer.prefilled !== undefined && { prefilled: offer.prefilled }),
    ...(offer.basis !== undefined && { basis: offer.basis }),
    ...(offer.evidence !== undefined && { evidence: offer.evidence }),
  };
  return { offers: offers.map((entry) => (entry === kept ? stored : entry)), stored };
}

/**
 * Record a decision about an offer. It is the only way a decision changes after the offer is stored,
 * and what it is given has to be a decision of an offer that is kept. A snooze needs the time it ends,
 * which no other decision takes, and the time of a dismissal, snooze or acceptance is kept beside it.
 * Which decisions the person may ask for, and from which state, is the caller's to judge.
 */
export function setDecisionIn(
  offers: readonly IOffer[],
  id: string,
  decision: unknown,
  details: { readonly at: string; readonly snoozedUntil?: string },
): { readonly offers: readonly IOffer[]; readonly stored: IOffer } {
  const chosen = oneOf(decision, 'decision', OFFER_DECISIONS);
  const kept = offers.find((entry) => entry.id === id);
  if (kept === undefined) throw new TaskCatalogRefusedError(`No offer ${id}`);
  if ((details.snoozedUntil !== undefined) !== (chosen === 'snoozed'))
    throw new TaskCatalogRefusedError(
      'A snooze needs the time it ends, and no other decision does',
    );
  const { snoozedUntil: _until, launchId: _launch, ...rest } = kept;
  const reactions =
    chosen === 'dismissed'
      ? stamped(kept.reactions, 'dismissed', details.at, true)
      : chosen === 'snoozed'
        ? stamped(kept.reactions, 'snoozed', details.at, true)
        : chosen === 'accepted'
          ? stamped(kept.reactions, 'accepted', details.at)
          : kept.reactions;
  const stored: IOffer = {
    ...rest,
    decision: chosen,
    ...(details.snoozedUntil !== undefined && {
      snoozedUntil: isoTime(details.snoozedUntil, 'snoozedUntil'),
    }),
    ...(chosen === 'accepted' && kept.launchId !== undefined && { launchId: kept.launchId }),
    ...(reactions !== undefined && { reactions }),
  };
  return { offers: offers.map((entry) => (entry === kept ? stored : entry)), stored };
}

/**
 * Record that an offer was started: it becomes accepted and names the launch it made. An offer that was
 * accepted by a launch already keeps that first launch, so a late repeat of the same record changes
 * nothing.
 */
export function acceptIn(
  offers: readonly IOffer[],
  id: string,
  launchId: string,
  at: string,
): { readonly offers: readonly IOffer[]; readonly stored: IOffer } {
  const kept = offers.find((entry) => entry.id === id);
  if (kept === undefined) throw new TaskCatalogRefusedError(`No offer ${id}`);
  if (kept.decision === 'accepted' && kept.launchId !== undefined) return { offers, stored: kept };
  const { snoozedUntil: _until, ...rest } = kept;
  const stored: IOffer = {
    ...rest,
    decision: 'accepted',
    launchId,
    reactions: stamped(kept.reactions, 'accepted', at),
  };
  return { offers: offers.map((entry) => (entry === kept ? stored : entry)), stored };
}

/** What the host records about how the person met an offer, and how the task it made ended. */
export type TOfferReaction =
  | { readonly kind: 'shown' | 'opened' | 'started' }
  | { readonly kind: 'outcome'; readonly state: TOutcomeState };

/**
 * Keep a reaction on each named offer that is stored, the first time only: a time never moves once it
 * is recorded, and an outcome, once decided, is not replaced. An offer that is gone is skipped.
 */
export function reactIn(
  offers: readonly IOffer[],
  ids: readonly string[],
  reaction: TOfferReaction,
  at: string,
): { readonly offers: readonly IOffer[]; readonly changed: boolean } {
  const wanted = new Set(ids);
  let changed = false;
  const next = offers.map((entry) => {
    if (!wanted.has(entry.id)) return entry;
    let reactions: IOfferReactions | undefined;
    if (reaction.kind === 'outcome') {
      if (entry.reactions?.outcome === undefined)
        reactions = {
          ...entry.reactions,
          outcome: { state: reaction.state, at },
          ...(reaction.state === 'verified' && { verified: at }),
        };
    } else if (entry.reactions?.[reaction.kind] === undefined) {
      reactions = { ...entry.reactions, [reaction.kind]: at };
    }
    if (reactions === undefined) return entry;
    changed = true;
    return { ...entry, reactions };
  });
  return { offers: changed ? next : offers, changed };
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
