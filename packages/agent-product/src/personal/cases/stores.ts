/**
 * Case stores: one held in memory (for tests, and for a host that keeps state elsewhere) and one in an
 * owner-only `cases.json`, rewritten atomically. The file keeps every open case and the newest closed
 * ones up to a bound, so an agent that runs for years does not grow without limit.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ICase, ICaseStore } from './types.js';

const CASE_ID = /^case-[a-z0-9]{1,40}$/;
const CLOSED_KEPT = 500;

export function createMemoryCaseStore(): ICaseStore {
  const cases = new Map<string, ICase>();
  return {
    list: async () => [...cases.values()],
    get: async (id) => cases.get(id),
    put: async (item) => {
      cases.set(item.id, item);
    },
  };
}

/** Every open case, and the closed ones that closed last. */
function bounded(cases: ICase[]): ICase[] {
  const closed = cases
    .filter((item) => item.state === 'closed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
    .slice(0, CLOSED_KEPT);
  return [...cases.filter((item) => item.state === 'open'), ...closed];
}

export function createFileCaseStore(directory: string): ICaseStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'cases.json');
  const read = (): Record<string, ICase> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, ICase>) : {};
  return {
    list: async () => Object.values(read()),
    // A record's own entry only: an id such as `constructor` must not reach the object's prototype.
    get: async (id) => {
      const cases = read();
      return Object.hasOwn(cases, id) ? cases[id] : undefined;
    },
    put: async (item) => {
      if (!CASE_ID.test(item.id)) throw new Error(`Invalid case id: ${item.id}`);
      const kept = bounded(Object.values({ ...read(), [item.id]: item }));
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(
        temporary,
        `${JSON.stringify(Object.fromEntries(kept.map((entry) => [entry.id, entry])), null, 2)}\n`,
        { mode: 0o600 },
      );
      renameSync(temporary, path);
    },
  };
}
