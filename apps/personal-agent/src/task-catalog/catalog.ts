/**
 * The task catalog the person browses: the product's built-in definitions and the ones the person
 * installed, each with whether the host can run it now, and the person's offers joined to their
 * definitions. It lists and checks; nothing here starts work.
 */
import { BUILT_IN_DEFINITIONS } from './built-in.js';
import { EMPTY_READINESS_CONTEXT, readinessOf } from './readiness.js';
import { parseOffer } from './validate-offer.js';

import type { IReadinessContext } from './readiness.js';
import type { ITaskCatalogStore } from './store.js';
import type {
  IOffer,
  IOfferListing,
  IOfferView,
  ITaskDefinition,
  ITaskDefinitionListing,
  TOfferDecision,
} from './types.js';

export interface ITaskCatalog {
  /** Built-in definitions in the product's order, then the person's, each with its readiness. */
  listDefinitions(): Promise<readonly ITaskDefinitionListing[]>;
  /** The latest revision, or the named one; absent when the catalog holds none such. */
  getDefinition(id: string, revision?: number): Promise<ITaskDefinition | undefined>;
  /** Open offers first, then the rest, each newest first; an offer whose task revision left reads as withdrawn. */
  listOffers(): Promise<IOfferListing>;
  /**
   * Keep an observed offer for a definition revision the catalog holds. It is stored open whatever
   * decision it claims; a key already kept updates that offer's evidence only. The offer's text is
   * stored and shown as given, and changes nothing about any definition.
   */
  submitOffer(input: unknown): Promise<IOffer>;
  /** Record the person's decision about a kept offer; an observation cannot. */
  setOfferDecision(id: string, decision: unknown): Promise<IOffer>;
}

export interface ITaskCatalogOptions {
  readonly store: ITaskCatalogStore;
  /** The shipped definitions; the product's own list unless a test supplies another. */
  readonly builtIn?: readonly ITaskDefinition[];
  /**
   * What the host knows right now about what it can run, asked each time the list is shown so that a
   * connector signing in or a tool decision changes the next answer. Without it nothing is verified.
   */
  readonly readiness?: () => Promise<IReadinessContext>;
}

export function createTaskCatalog(options: ITaskCatalogOptions): ITaskCatalog {
  const { store } = options;
  const builtIn = options.builtIn ?? BUILT_IN_DEFINITIONS;
  const readiness = options.readiness ?? (async () => EMPTY_READINESS_CONTEXT);
  /** The built-in revisions, then the person's; a built-in id is never replaced by an installed one. */
  const held = async (): Promise<readonly ITaskDefinition[]> => {
    const taken = new Set(builtIn.map((definition) => definition.id));
    const installed = (await store.listDefinitions()).filter((entry) => !taken.has(entry.id));
    return [...builtIn, ...installed];
  };
  const latest = (definitions: readonly ITaskDefinition[]): ITaskDefinition[] => {
    const newest = new Map<string, ITaskDefinition>();
    for (const definition of definitions) {
      const known = newest.get(definition.id);
      if (known === undefined || definition.revision > known.revision)
        newest.set(definition.id, definition);
    }
    return [...newest.values()];
  };
  return {
    listDefinitions: async () => {
      const context = await readiness();
      return latest(await held()).map((definition) => ({
        ...definition,
        readiness: readinessOf(definition, context),
      }));
    },
    getDefinition: async (id, revision) => {
      const matching = (await held()).filter((definition) => definition.id === id);
      return revision === undefined
        ? latest(matching)[0]
        : matching.find((definition) => definition.revision === revision);
    },
    listOffers: async () => {
      const definitions = await held();
      const rank = (view: IOfferView): number =>
        view.decision === 'open' && !view.withdrawn ? 0 : 1;
      const offers = (await store.listOffers()).map(({ dedupeKey: _key, ...offer }): IOfferView => {
        const definition = definitions.find(
          (entry) => entry.id === offer.definitionId && entry.revision === offer.definitionRevision,
        );
        return {
          ...offer,
          ...(definition !== undefined && { definitionTitle: definition.title }),
          withdrawn: definition === undefined,
        };
      });
      offers.sort(
        (a, b) =>
          rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
      return { offers, issues: await store.issues() };
    },
    submitOffer: async (input) => {
      const definitions = await held();
      const offer = parseOffer(input, (id, revision) =>
        definitions.find((entry) => entry.id === id && entry.revision === revision),
      );
      return store.putOffer(offer);
    },
    setOfferDecision: (id, decision) => store.setOfferDecision(id, decision as TOfferDecision),
  };
}
