/**
 * Where the person's launch intents live. A host supplies one store per owner; the file adapter is
 * beside this. The store keeps the rules of `records.ts`; it decides nothing about when to launch.
 */
import { advanceIn, decideIn, recordIn, reserveInto } from './records.js';

import type { TLaunchChange } from './records.js';
import type { IEvidenceReceipt, ILaunchIntent, ILaunchOutcome } from './types.js';

export interface ILaunchStore {
  /** Every kept intent, newest first. */
  list(): Promise<readonly ILaunchIntent[]>;
  get(id: string): Promise<ILaunchIntent | undefined>;
  findByKey(key: string): Promise<ILaunchIntent | undefined>;
  /** Keep a new, reserved intent. It is on disk when this returns, before any goal is made for it. */
  reserve(intent: ILaunchIntent): Promise<void>;
  /** Move a reserved intent to where it ended; asking again for the same ending changes nothing. */
  advance(id: string, change: TLaunchChange): Promise<ILaunchIntent>;
  /**
   * Keep a receipt the host's browser made for a run of a launched intent still waiting for its
   * outcome. False when none was kept: the intent ended, has its outcome, or is another goal's.
   */
  recordReceipt(
    id: string,
    goalId: string,
    runId: string,
    receipt: IEvidenceReceipt,
  ): Promise<boolean>;
  /** Decide a launched intent's outcome, with its receipts dropped; an intent that has one keeps it and is answered as it is. */
  decide(id: string, outcome: ILaunchOutcome): Promise<ILaunchIntent>;
  /** What could not be read from what was saved, in words that name no path. */
  issues(): Promise<readonly string[]>;
}

export const newestFirst = (intents: readonly ILaunchIntent[]): readonly ILaunchIntent[] =>
  [...intents].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

/** The intents held in memory, for tests and for a host that keeps state somewhere else. */
export function createMemoryLaunchStore(options: { readonly now?: () => Date } = {}): ILaunchStore {
  const now = options.now ?? (() => new Date());
  let intents: readonly ILaunchIntent[] = [];
  return {
    list: async () => newestFirst(intents),
    get: async (id) => intents.find((entry) => entry.id === id),
    findByKey: async (key) => intents.find((entry) => entry.idempotencyKey === key),
    reserve: async (intent) => {
      intents = reserveInto(intents, intent);
    },
    advance: async (id, change) => {
      const next = advanceIn(intents, id, change, now().toISOString());
      intents = next.intents;
      return next.stored;
    },
    recordReceipt: async (id, goalId, runId, receipt) => {
      const next = recordIn(intents, id, goalId, runId, receipt);
      intents = next.intents;
      return next.recorded;
    },
    decide: async (id, outcome) => {
      const next = decideIn(intents, id, outcome);
      intents = next.intents;
      return next.stored;
    },
    issues: async () => [],
  };
}
