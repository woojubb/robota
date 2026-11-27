/**
 * The rules every launch store keeps, so the memory and file adapters cannot drift apart: one intent
 * for a key and for an id, an intent that only moves forward from reserved, and a bound on how many
 * are kept in which an unfinished intent is never the one that goes.
 */
import { TaskCatalogRefusedError } from '../fields.js';
import { isPageRefusal, sameRefusal } from './receipts.js';
import { LAUNCH_LIMITS, parseIntent } from './validate.js';

import type {
  ILaunchBinding,
  ILaunchFailure,
  ILaunchIntent,
  ILaunchOutcome,
  TBrowserReceipt,
} from './types.js';

export const MAX_LAUNCHES = 200;

/**
 * Where an unfinished intent can go. A request that waits (`setup`, `review`) or is reserved moves
 * with what it should now hold: the choices made, whether its access changed, the access to look at,
 * and, once reserved, the access it will run on and when it was reserved.
 */
export type TLaunchChange =
  | { readonly status: 'launched'; readonly goalId: string }
  | { readonly status: 'failed'; readonly failure: ILaunchFailure }
  | { readonly status: 'cancelled' }
  | ({ readonly status: 'setup' | 'review' | 'reserved' } & ILaunchWaiting);

/** What a request that waits may change as it moves; what is left out stays as it was. */
export interface ILaunchWaiting {
  readonly chosenAccounts?: readonly string[];
  /** Sets the sticky flag; there is no way to clear it. */
  readonly authorityChanged?: true;
  /** For `review`: the access to look at and its digest. */
  readonly proposed?: readonly ILaunchBinding[];
  readonly reviewDigest?: string;
  /** For `reserved`: the access it will run on and when it was reserved. */
  readonly bindings?: readonly ILaunchBinding[];
  readonly reservedAt?: string;
}

/** Where each status may go; a request that made a goal or ended goes nowhere. */
const MOVES: Readonly<Record<string, readonly string[]>> = {
  setup: ['setup', 'review', 'reserved', 'failed', 'cancelled'],
  review: ['review', 'setup', 'reserved', 'failed', 'cancelled'],
  reserved: ['launched', 'failed', 'cancelled'],
};

const unfinished = (intent: ILaunchIntent): boolean => intent.status in MOVES;

/**
 * Keep a new intent, which is reserved to make its goal or waiting for setup. At the bound the oldest finished ones go first, and a
 * launch still waiting is never dropped: with nothing finished to drop, the new one is refused.
 */
export function reserveInto(
  intents: readonly ILaunchIntent[],
  intent: ILaunchIntent,
): readonly ILaunchIntent[] {
  const fresh = parseIntent(intent);
  if (fresh.status !== 'reserved' && fresh.status !== 'setup')
    throw new TaskCatalogRefusedError(
      'A launch is kept as reserved or waiting for setup before it is anything else',
    );
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
 * Move an unfinished intent along its allowed moves. The same ending again is the intent as it is, so
 * a retry after a write whose answer was lost changes nothing; any other change to an ended intent, or
 * a move the intent's status does not allow, is refused.
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
  if (!MOVES[kept.status]!.includes(change.status))
    throw new TaskCatalogRefusedError(
      `A launch that is ${kept.status} cannot become ${change.status}`,
    );
  const {
    status: _status,
    goalId: _goalId,
    failure: _failure,
    proposed: _proposed,
    reviewDigest: _reviewDigest,
    ...rest
  } = kept;
  const waiting =
    change.status === 'setup' || change.status === 'review' || change.status === 'reserved';
  const stored = parseIntent({
    ...rest,
    ...change,
    // Once the access changed it stays changed, whatever a later move says.
    ...((kept.authorityChanged === true || (waiting && change.authorityChanged === true)) && {
      authorityChanged: true,
    }),
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
