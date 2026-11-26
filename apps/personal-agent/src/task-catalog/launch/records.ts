/**
 * The rules every launch store keeps, so the memory and file adapters cannot drift apart: one intent
 * for a key and for an id, an intent that only moves forward from reserved, and a bound on how many
 * are kept in which an unfinished intent is never the one that goes.
 */
import { TaskCatalogRefusedError } from '../fields.js';
import { isPageRefusal, sameRefusal } from './receipts.js';
import { LAUNCH_LIMITS, parseIntent } from './validate.js';

import type { ILaunchFailure, ILaunchIntent, ILaunchOutcome, TBrowserReceipt } from './types.js';

export const MAX_LAUNCHES = 200;

/** Where a reserved intent can go: it is the only status that is not an end. */
export type TLaunchChange =
  | { readonly status: 'launched'; readonly goalId: string }
  | { readonly status: 'failed'; readonly failure: ILaunchFailure }
  | { readonly status: 'cancelled' };

const unfinished = (intent: ILaunchIntent): boolean => intent.status === 'reserved';

/**
 * Keep a new intent, which is always reserved. At the bound the oldest finished ones go first, and a
 * launch still waiting is never dropped: with nothing finished to drop, the new one is refused.
 */
export function reserveInto(
  intents: readonly ILaunchIntent[],
  intent: ILaunchIntent,
): readonly ILaunchIntent[] {
  const fresh = parseIntent(intent);
  if (fresh.status !== 'reserved')
    throw new TaskCatalogRefusedError('A launch is kept as reserved before it is anything else');
  if (intents.some((entry) => entry.id === fresh.id))
    throw new TaskCatalogRefusedError('Another launch already has this id');
  if (intents.some((entry) => entry.idempotencyKey === fresh.idempotencyKey))
    throw new TaskCatalogRefusedError('Another launch already has this key');
  const excess = intents.length + 1 - MAX_LAUNCHES;
  if (excess <= 0) return [...intents, fresh];
  const finished = intents
    .filter((entry) => !unfinished(entry))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (finished.length < excess)
    throw new TaskCatalogRefusedError(`At most ${MAX_LAUNCHES} launches can wait at once`);
  const dropped = new Set(finished.slice(0, excess));
  return [...intents.filter((entry) => !dropped.has(entry)), fresh];
}

/**
 * Move a reserved intent to where it ended. The same ending again is the intent as it is, so a retry
 * after a write whose answer was lost changes nothing; any other change to an ended intent is refused.
 */
export function advanceIn(
  intents: readonly ILaunchIntent[],
  id: string,
  change: TLaunchChange,
  at: string,
): { readonly intents: readonly ILaunchIntent[]; readonly stored: ILaunchIntent } {
  const kept = intents.find((entry) => entry.id === id);
  if (kept === undefined) throw new TaskCatalogRefusedError(`No launch ${id}`);
  if (!unfinished(kept)) {
    const same =
      kept.status === change.status &&
      (change.status !== 'launched' || kept.goalId === change.goalId);
    if (same) return { intents, stored: kept };
    throw new TaskCatalogRefusedError(`This launch already ended as ${kept.status}`);
  }
  const { status: _status, goalId: _goalId, failure: _failure, ...rest } = kept;
  const stored = parseIntent({
    ...rest,
    ...change,
    updatedAt: at < kept.createdAt ? kept.createdAt : at,
  });
  return { intents: intents.map((entry) => (entry === kept ? stored : entry)), stored };
}

/**
 * Keep one receipt the host's browser made for a run of a launch that is waiting for its outcome: a
 * page it returned, or a refusal to. A launch that ended, already has its outcome, or belongs to another
 * goal takes none, a receipt already kept is not kept twice, and at most as many are kept of each kind as
 * the bounds say: reads and refusals have rooms of their own, so a run that read a great deal still has
 * its refusals kept. What is not kept is simply not evidence, and a refusal that is not kept only loses
 * the note of it. Only the newest run's receipts are of use, since a goal's outcome is decided from the
 * run that ended it, so the first receipt of a later run replaces those of the runs before it.
 */
export function recordIn(
  intents: readonly ILaunchIntent[],
  id: string,
  goalId: string,
  runId: string,
  receipt: TBrowserReceipt,
): { readonly intents: readonly ILaunchIntent[]; readonly recorded: boolean } {
  const kept = intents.find((entry) => entry.id === id);
  if (
    kept === undefined ||
    kept.status !== 'launched' ||
    kept.outcome !== undefined ||
    kept.goalId !== goalId
  )
    return { intents, recorded: false };
  const have = (kept.receipts ?? []).filter((entry) => entry.runId === runId);
  const again = have.some((entry) => {
    if (isPageRefusal(receipt)) return isPageRefusal(entry) && sameRefusal(entry, receipt);
    return (
      !isPageRefusal(entry) &&
      entry.tool === receipt.tool &&
      entry.requested === receipt.requested &&
      entry.address === receipt.address &&
      entry.digest === receipt.digest
    );
  });
  const room = isPageRefusal(receipt) ? LAUNCH_LIMITS.refusals : LAUNCH_LIMITS.receipts;
  const used = have.filter((entry) => isPageRefusal(entry) === isPageRefusal(receipt)).length;
  if (again || used >= room) return { intents, recorded: false };
  const stored = parseIntent({ ...kept, receipts: [...have, { ...receipt, runId }] });
  return { intents: intents.map((entry) => (entry === kept ? stored : entry)), recorded: true };
}

/**
 * Decide a launched intent's outcome, once. Asked again, with the same outcome or another, it is the
 * intent as it stands: an outcome never changes. The receipts it was decided from are dropped, since
 * the outcome keeps the ones worth showing. `updatedAt` marks when the request itself last moved and
 * stays as it was, so the answer to a start is the same before and after its outcome.
 */
export function decideIn(
  intents: readonly ILaunchIntent[],
  id: string,
  outcome: ILaunchOutcome,
): { readonly intents: readonly ILaunchIntent[]; readonly stored: ILaunchIntent } {
  const kept = intents.find((entry) => entry.id === id);
  if (kept === undefined) throw new TaskCatalogRefusedError(`No launch ${id}`);
  if (kept.status !== 'launched')
    throw new TaskCatalogRefusedError('Only a launch that made a goal has an outcome');
  if (kept.outcome !== undefined) return { intents, stored: kept };
  const { receipts: _receipts, ...rest } = kept;
  const stored = parseIntent({ ...rest, outcome });
  return { intents: intents.map((entry) => (entry === kept ? stored : entry)), stored };
}
