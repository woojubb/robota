/**
 * The launch intents as one owner-only file, `launches.json`, in the task-catalog directory: rewritten
 * whole through a temporary file and a rename, so a failed write leaves the previous file in place and
 * an intent that was kept is never half written.
 *
 * A missing file starts empty. A file that cannot be read, or an intent in it that is not what this
 * module writes, is not shown and is reported as an issue; the next write first copies the damaged file
 * to `launches.json.damaged`, so repairing it by hand stays possible.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { readRecords, writeAtomically } from '../json-records.js';
import { advanceIn, decideIn, recordIn, reserveInto } from './records.js';
import { newestFirst } from './store.js';
import { parseIntent } from './validate.js';

import type { ILaunchStore } from './store.js';

export function createFileLaunchStore(options: {
  readonly directory: string;
  readonly now?: () => Date;
}): ILaunchStore {
  const now = options.now ?? (() => new Date());
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, 'launches.json');
  const read = () =>
    readRecords(path, 'launches', { one: 'launch', many: 'launches' }, parseIntent);
  const save = (current: ReturnType<typeof read>, intents: readonly unknown[]): void => {
    if (current.issue !== undefined && existsSync(path)) copyFileSync(path, `${path}.damaged`);
    writeAtomically(path, { launches: intents });
  };
  return {
    list: async () => newestFirst(read().records),
    get: async (id) => read().records.find((entry) => entry.id === id),
    findByKey: async (key) => read().records.find((entry) => entry.idempotencyKey === key),
    reserve: async (intent) => {
      const current = read();
      save(current, reserveInto(current.records, intent));
    },
    advance: async (id, change) => {
      const current = read();
      const next = advanceIn(current.records, id, change, now().toISOString());
      if (next.intents !== current.records) save(current, next.intents);
      return next.stored;
    },
    recordReceipt: async (id, goalId, runId, receipt) => {
      const current = read();
      const next = recordIn(current.records, id, goalId, runId, receipt);
      if (next.recorded) save(current, next.intents);
      return next.recorded;
    },
    decide: async (id, outcome) => {
      const current = read();
      const next = decideIn(current.records, id, outcome);
      if (next.intents !== current.records) save(current, next.intents);
      return next.stored;
    },
    issues: async () => {
      const { issue } = read();
      return issue === undefined ? [] : [issue];
    },
  };
}
