/**
 * The task-catalog records as owner-only files: `offers.json` and `definitions.json` in a directory
 * only the owner can enter, each rewritten whole through a temporary file and a rename, so a failed
 * write leaves the previous file in place.
 *
 * A file that is missing starts empty. A file that cannot be read, or a record in it that is not what
 * this module writes, is not shown and is reported as an issue instead of failing the page. The next
 * write first copies the damaged file to `<name>.damaged`, so repairing it by hand stays possible.
 */
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { putDefinitionInto, putOfferInto, readOffer, setDecisionIn } from './records.js';
import { parseDefinition } from './validate-definition.js';
import { parseOffer } from './validate-offer.js';

import type { ITaskCatalogStore } from './store.js';
import type { IOffer, ITaskDefinition } from './types.js';

interface IRead<T> {
  readonly records: readonly T[];
  readonly issue?: string;
}

function writeAtomically(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** One file's records. The issue names the kind of record and never a path or the parser's message. */
function readRecords<T>(
  path: string,
  key: string,
  noun: { readonly one: string; readonly many: string },
  parse: (raw: unknown) => T,
): IRead<T> {
  if (!existsSync(path)) return { records: [] };
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[key];
  } catch {
    // allow-fallback: a file that cannot be read starts empty, and says so as an issue.
    raw = undefined;
  }
  if (!Array.isArray(raw))
    return { records: [], issue: `Saved ${noun.many} could not be read, so none are shown.` };
  const records: T[] = [];
  for (const entry of raw) {
    try {
      records.push(parse(entry));
    } catch {
      // allow-fallback: one record that is not valid is left out and counted in the issue below.
    }
  }
  const skipped = raw.length - records.length;
  if (skipped === 0) return { records };
  return {
    records,
    issue:
      skipped === 1
        ? `1 saved ${noun.one} could not be read and is not shown.`
        : `${skipped} saved ${noun.many} could not be read and are not shown.`,
  };
}

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
    setOfferDecision: async (id, decision) => {
      const current = readOffers();
      const put = setDecisionIn(current.records, id, decision);
      save(offersPath, 'offers', current, put.offers);
      return readOffer(put.stored, now());
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
