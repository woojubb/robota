/**
 * Where the person's offers and the definitions they installed live. The built-in definitions ship with
 * the product and are not stored. A host supplies one store per owner; the file adapter is beside this.
 */
import { putDefinitionInto, putOfferInto, readOffer } from './records.js';
import { parseDefinition } from './validate-definition.js';
import { parseOffer } from './validate-offer.js';

import type { IOffer, ITaskDefinition } from './types.js';

export interface ITaskCatalogStore {
  /** Every stored offer; an open one past its expiry reads as expired. */
  listOffers(): Promise<readonly IOffer[]>;
  getOffer(id: string): Promise<IOffer | undefined>;
  /** Keep an offer; one with a dedupe key already stored updates that offer instead of adding a copy. */
  putOffer(offer: IOffer): Promise<IOffer>;
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
    listDefinitions: async () => definitions,
    putDefinition: async (definition) => {
      definitions = putDefinitionInto(definitions, parseDefinition(definition));
    },
    issues: async () => [],
  };
}
