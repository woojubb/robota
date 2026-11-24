/**
 * Where the person's offers and the definitions they installed live. The built-in definitions ship with
 * the product and are not stored. A host supplies one store per owner; the file adapter is beside this.
 */
import {
  acceptIn,
  putDefinitionInto,
  putOfferInto,
  reactIn,
  readOffer,
  setDecisionIn,
} from './records.js';
import { parseDefinition } from './validate-definition.js';
import { parseOffer } from './validate-offer.js';

import type { TOfferReaction } from './records.js';
import type { IOffer, ITaskDefinition, TOfferDecision } from './types.js';

export interface ITaskCatalogStore {
  /** Every stored offer; an open one past its expiry reads as expired, and a snoozed one whose time has come as open. */
  listOffers(): Promise<readonly IOffer[]>;
  getOffer(id: string): Promise<IOffer | undefined>;
  /**
   * Keep an observed offer. A new one is stored open whatever decision it claims. One whose dedupe key
   * is already stored updates that offer's evidence and nothing the person decided or the offer began
   * as; no offer is added twice for a key.
   */
  putOffer(offer: IOffer): Promise<IOffer>;
  /**
   * Record a decision about a stored offer: the only change of a decision after it is kept, with a
   * snooze given the time it ends. Which decisions the person may ask for is the caller's to judge.
   */
  setOfferDecision(
    id: string,
    decision: TOfferDecision,
    options?: { readonly snoozedUntil?: string },
  ): Promise<IOffer>;
  /** Record that an offer was started, which accepts it and names its launch; the first launch stays. */
  acceptOffer(id: string, launchId: string): Promise<IOffer>;
  /** Record how the person met offers, or how the task one made ended, once each; offers that are gone are skipped. */
  recordReaction(ids: readonly string[], reaction: TOfferReaction): Promise<void>;
  /** Every stored revision of every definition the person installed. */
  listDefinitions(): Promise<readonly ITaskDefinition[]>;
  /** Keep a definition revision; a revision already stored cannot change. */
  putDefinition(definition: ITaskDefinition): Promise<void>;
  /** What could not be read from what was saved, in words that name no path. */
  issues(): Promise<readonly string[]>;
}

/** The records held in memory, for tests and for a host that keeps state somewhere else. */
export function createMemoryTaskCatalogStore(
  options: { readonly now?: () => Date } = {},
): ITaskCatalogStore {
  const now = options.now ?? (() => new Date());
  let offers: readonly IOffer[] = [];
  let definitions: readonly ITaskDefinition[] = [];
  return {
    listOffers: async () => offers.map((offer) => readOffer(offer, now())),
    getOffer: async (id) => {
      const offer = offers.find((entry) => entry.id === id);
      return offer === undefined ? undefined : readOffer(offer, now());
    },
    putOffer: async (offer) => {
      const put = putOfferInto(offers, parseOffer(offer));
      offers = put.offers;
      return readOffer(put.stored, now());
    },
    setOfferDecision: async (id, decision, options = {}) => {
      const put = setDecisionIn(offers, id, decision, {
        at: now().toISOString(),
        ...(options.snoozedUntil !== undefined && { snoozedUntil: options.snoozedUntil }),
      });
      offers = put.offers;
      return readOffer(put.stored, now());
    },
    acceptOffer: async (id, launchId) => {
      const put = acceptIn(offers, id, launchId, now().toISOString());
      offers = put.offers;
      return readOffer(put.stored, now());
    },
    recordReaction: async (ids, reaction) => {
      offers = reactIn(offers, ids, reaction, now().toISOString()).offers;
    },
    listDefinitions: async () => definitions,
    putDefinition: async (definition) => {
      definitions = putDefinitionInto(definitions, parseDefinition(definition));
    },
    issues: async () => [],
  };
}
