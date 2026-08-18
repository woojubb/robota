/**
 * HANDOFF-001 (#1811): what actually gets built and sent, and how the destination knows it arrived
 * whole.
 *
 * `handoff-ownership.ts` owns the phase transitions — who is authoritative when. This owns the two
 * things that have to be true before those transitions mean anything: the inventory is COMPLETE, and
 * the payload is INTACT.
 *
 * ## The inventory is not a summary
 *
 * The issue requires every category to be classified explicitly rather than left to implementation,
 * and the inventory carries the items that are NOT coming along as well as the ones that are. That
 * is the whole reason it is a list of classified items instead of a boolean per feature: a user at
 * either end has to be able to see that their uncommitted changes stayed behind, and a destination
 * has to be able to see that a credential was never in the payload rather than missing from it.
 *
 * Two dispositions look similar and are not. `source-local` is a product decision — the working-tree
 * changes could be moved, and moving them would make this a file-sync product. `never-transferred`
 * is a rule: SEC-009 established that a resolved credential must not cross a process boundary, and
 * a machine boundary is strictly worse.
 *
 * ## In-flight work is refused, not captured
 *
 * A turn in flight has an outcome that belongs in the history being transferred. Serializing the
 * record mid-turn produces a manifest whose integrity digest is correct for a session state that
 * never existed as a settled thing. So the builder REFUSES rather than snapshotting, and the caller
 * decides whether to wait — a choice it can only make if it was told.
 *
 * ## Integrity is checked in a specific order
 *
 * Length first, then digest. A truncated transfer is the common failure and the cheap one to
 * detect; hashing a short buffer to discover it was short wastes the work and, worse, reports it as
 * a digest mismatch — which reads as corruption or tampering rather than a dropped connection.
 */

import { createHash } from 'node:crypto';

import type {
  IHandoffIntegrity,
  IHandoffManifest,
  IHandoffStateItem,
  IInteractiveSessionRecord,
  THandoffRefusal,
} from '@robota-sdk/agent-interface-transport';

/** What the source knows about work that has not settled, and about state the record cannot see. */
export interface ISourceRuntimeState {
  /** A model call is in flight. */
  readonly modelCallInFlight?: boolean;
  /** How many tool calls have started and not finished. */
  readonly toolCallsInFlight?: number;
  /** Child processes the session started. They cannot migrate. */
  readonly subprocesses?: number;
  /** The working tree has changes that are not committed. */
  readonly uncommittedChanges?: boolean;
}

export interface IBuildManifestInput {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly sourceDeviceId: string;
  readonly destinationDeviceId: string;
  readonly record: IInteractiveSessionRecord;
  readonly runtime: ISourceRuntimeState;
  readonly offeredAt: number;
}

export type TManifestResult =
  | {
      readonly built: true;
      readonly manifest: IHandoffManifest;
      /** The exact bytes whose digest is in the manifest. Send THESE, not a re-serialization. */
      readonly serialized: string;
    }
  | { readonly built: false; readonly refusal: THandoffRefusal; readonly detail: string };

/**
 * Serialize a record and describe what was serialized.
 *
 * The string is returned alongside the integrity data because the digest is only meaningful for
 * these exact bytes. A caller that re-serialized the record before sending could produce a
 * different key order and a digest mismatch on a payload that is perfectly correct — a corruption
 * report caused by the corruption check.
 */
export function sealHandoffRecord(record: IInteractiveSessionRecord): {
  serialized: string;
  integrity: IHandoffIntegrity;
} {
  const serialized = JSON.stringify(record);
  const bytes = Buffer.from(serialized, 'utf8');
  return {
    serialized,
    integrity: {
      digest: createHash('sha256').update(bytes).digest('base64url'),
      byteLength: bytes.byteLength,
    },
  };
}

/** Why a received payload was not accepted. */
export type TIntegrityFailure = 'truncated' | 'digest-mismatch';

export interface IIntegrityVerdict {
  readonly intact: boolean;
  readonly failure?: TIntegrityFailure;
  /** What the manifest promised and what arrived, so a report can say more than "it failed". */
  readonly expectedBytes?: number;
  readonly actualBytes?: number;
}

/**
 * Check a received payload against the manifest's integrity metadata.
 *
 * Nothing is parsed here. Parsing a payload to check it is well-formed would mean building the
 * object graph before knowing whether the bytes are the ones that were sent, and a destination that
 * has already parsed a corrupt payload has already spent the effort this check exists to avoid.
 */
export function verifyHandoffPayload(
  serialized: string,
  integrity: IHandoffIntegrity,
): IIntegrityVerdict {
  const bytes = Buffer.from(serialized, 'utf8');
  if (bytes.byteLength !== integrity.byteLength) {
    return {
      intact: false,
      failure: 'truncated',
      expectedBytes: integrity.byteLength,
      actualBytes: bytes.byteLength,
    };
  }
  const digest = createHash('sha256').update(bytes).digest('base64url');
  if (digest !== integrity.digest) return { intact: false, failure: 'digest-mismatch' };
  return { intact: true };
}

/**
 * Classify every category the issue names, including the ones staying behind.
 *
 * Built from the record and the runtime state together, because half the answer is not in the
 * record: it cannot know whether a tool call is running or whether the working tree is dirty.
 */
function inventory(
  record: IInteractiveSessionRecord,
  runtime: ISourceRuntimeState,
): IHandoffStateItem[] {
  const items: IHandoffStateItem[] = [
    { kind: 'conversation', disposition: 'transferred' },
    { kind: 'session-metadata', disposition: 'transferred' },
    {
      kind: 'provider-credentials',
      disposition: 'never-transferred',
      note: 'The destination resolves its own credential. A hand-off to a machine without one fails at commit, loudly, rather than silently later.',
    },
    {
      kind: 'working-directory',
      disposition: 'rehydrated',
      note: `The path '${record.cwd}' is meaningless on the destination; it is carried so the destination can locate or ask for the corresponding checkout. A mismatch is surfaced, not guessed.`,
    },
  ];

  // Present-only entries: an inventory that listed every optional field regardless would tell a user
  // that goal state "stayed behind" when there was never any goal state.
  if (record.goal !== undefined || record.plan !== undefined) {
    items.push({ kind: 'goal-and-plan', disposition: 'transferred' });
  }
  if (record.backgroundTasks?.length || record.backgroundJobGroups?.length) {
    items.push({ kind: 'background-work', disposition: 'transferred' });
  }
  if (record.sandboxSnapshotId !== undefined) {
    items.push({
      kind: 'sandbox-snapshot',
      disposition: 'rehydrated',
      note: 'Carried as a reference. Its validity on the destination is checked, not assumed.',
    });
  }
  if (runtime.uncommittedChanges === true) {
    items.push({
      kind: 'uncommitted-changes',
      disposition: 'source-local',
      note: 'Moving these would make the hand-off a file-sync product. Their existence is reported at both ends so the choice is yours.',
    });
  }
  if ((runtime.subprocesses ?? 0) > 0) {
    items.push({
      kind: 'subprocesses',
      disposition: 'source-local',
      note: `${runtime.subprocesses} running process(es) stay here. A process cannot migrate, and pretending otherwise would resume a session whose tools point at dead pids.`,
    });
  }
  return items;
}

/**
 * Build the offer, or refuse to.
 *
 * Refusal comes first and is not a failure of the transfer — it is the transfer declining to start
 * on state that is not settled. `handoff-ownership.ts` never sees an offer that should not have been
 * made.
 */
export function buildHandoffManifest(input: IBuildManifestInput): TManifestResult {
  const toolCalls = input.runtime.toolCallsInFlight ?? 0;
  if (input.runtime.modelCallInFlight === true || toolCalls > 0) {
    return {
      built: false,
      refusal: 'in-flight-work',
      detail:
        'A turn is still running, and its outcome belongs in the history being transferred. ' +
        'Snapshotting now would produce a manifest whose digest is correct for a session state ' +
        'that never settled. Wait for it, or cancel it.',
    };
  }

  const { serialized, integrity } = sealHandoffRecord(input.record);
  return {
    built: true,
    serialized,
    manifest: {
      handoffId: input.handoffId,
      sessionId: input.sessionId,
      sourceDeviceId: input.sourceDeviceId,
      destinationDeviceId: input.destinationDeviceId,
      inventory: inventory(input.record, input.runtime),
      integrity,
      offeredAt: input.offeredAt,
    },
  };
}
