/**
 * The task-catalog records as owner-only files: `offers.json` and `definitions.json` in a directory
 * only the owner can enter, each rewritten whole through a temporary file and a rename, so a failed
 * write leaves the previous file in place.
 *
 * A file that is missing starts empty. A file that cannot be read, or a record in it that is not what
 * this module writes, is not shown and is reported as an issue instead of failing the page. The next
 * write first copies the damaged file to `<name>.damaged`, so repairing it by hand stays possible.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { readRecords, writeAtomically } from './json-records.js';
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

import type { IRead } from './json-records.js';
import type { ITaskCatalogStore } from './store.js';
import type { IOffer, ITaskDefinition } from './types.js';

export function createFileTaskCatalogStore(options: {
  readonly directory: string;
  readonly now?: () => Date;
}): ITaskCatalogStore {
  const now = options.now ?? (() => new Date());
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const offersPath = join(options.directory, 'offers.json');
  const definitionsPath = join(options.directory, 'definitions.json');
  const readOffers = (): IRead<IOffer> =>
    readRecords(offersPath, 'offers', { one: 'offer', many: 'offers' }, (entry) =>
      parseOffer(entry),
    );
  const readDefinitions = (): IRead<ITaskDefinition> =>
    readRecords(
      definitionsPath,
      'definitions',
      { one: 'task definition', many: 'task definitions' },
      parseDefinition,
    );
  /**
   * Replace a file's records. A damaged file is copied aside first, and stays where it is until the
   * new file replaces it, so a write that fails loses nothing.
   */
  const save = (path: string, key: string, read: IRead<unknown>, records: readonly unknown[]) => {
    if (read.issue !== undefined && existsSync(path)) copyFileSync(path, `${path}.damaged`);
    writeAtomically(path, { [key]: records });
  };
  return {
    listOffers: async () => readOffers().records.map((offer) => readOffer(offer, now())),
    getOffer: async (id) => {
      const offer = readOffers().records.find((entry) => entry.id === id);
      return offer === undefined ? undefined : readOffer(offer, now());
    },
    putOffer: async (offer) => {
      const current = readOffers();
      const put = putOfferInto(current.records, parseOffer(offer));
      save(offersPath, 'offers', current, put.offers);
      return readOffer(put.stored, now());
    },
    setOfferDecision: async (id, decision, options = {}) => {
      const current = readOffers();
      const put = setDecisionIn(current.records, id, decision, {
        at: now().toISOString(),
        ...(options.snoozedUntil !== undefined && { snoozedUntil: options.snoozedUntil }),
      });
      save(offersPath, 'offers', current, put.offers);
      return readOffer(put.stored, now());
    },
    acceptOffer: async (id, launchId) => {
      const current = readOffers();
      const put = acceptIn(current.records, id, launchId, now().toISOString());
      if (put.offers !== current.records) save(offersPath, 'offers', current, put.offers);
      return readOffer(put.stored, now());
    },
    recordReaction: async (ids, reaction) => {
      const current = readOffers();
      const put = reactIn(current.records, ids, reaction, now().toISOString());
      if (put.changed) save(offersPath, 'offers', current, put.offers);
    },
    listDefinitions: async () => readDefinitions().records,
    putDefinition: async (definition) => {
      const current = readDefinitions();
      const next = putDefinitionInto(current.records, parseDefinition(definition));
      save(definitionsPath, 'definitions', current, next);
    },
    issues: async () =>
      [readOffers().issue, readDefinitions().issue].filter(
        (issue): issue is string => issue !== undefined,
      ),
  };
}
