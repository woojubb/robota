import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type {
  IHandoffIntegrity,
  IHandoffManifest,
  IHandoffStateItem,
  THandoffRefusal,
} from './handoff-contracts.js';

/** Source-only state that a persisted session record cannot describe. */
export interface ISourceRuntimeState {
  readonly modelCallInFlight?: boolean;
  readonly toolCallsInFlight?: number;
  readonly subprocesses?: number;
  readonly uncommittedChanges?: boolean;
}

export interface IPrepareHandoffOfferInput {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly sourceDeviceId: string;
  readonly destinationDeviceId: string;
  readonly record: IInteractiveSessionRecord;
  readonly runtime: ISourceRuntimeState;
  readonly integrity: IHandoffIntegrity;
  readonly offeredAt: number;
}

export type THandoffOfferResult =
  | { readonly built: true; readonly manifest: IHandoffManifest }
  | { readonly built: false; readonly refusal: THandoffRefusal; readonly detail: string };

export type THandoffReadiness =
  | { readonly ready: true }
  | { readonly ready: false; readonly refusal: THandoffRefusal; readonly detail: string };

export function assessHandoffReadiness(runtime: ISourceRuntimeState): THandoffReadiness {
  const toolCalls = runtime.toolCallsInFlight ?? 0;
  if (runtime.modelCallInFlight !== true && toolCalls <= 0) return { ready: true };
  return {
    ready: false,
    refusal: 'in-flight-work',
    detail:
      'A turn is still running, and its outcome belongs in the history being transferred. ' +
      'Snapshotting now would produce a manifest whose digest is correct for a session state ' +
      'that never settled. Wait for it, or cancel it.',
  };
}

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

/** Refuse unsettled work before an offer exists; classify all state at the domain boundary. */
export function prepareHandoffOffer(input: IPrepareHandoffOfferInput): THandoffOfferResult {
  const readiness = assessHandoffReadiness(input.runtime);
  if (!readiness.ready) {
    return {
      built: false,
      refusal: readiness.refusal,
      detail: readiness.detail,
    };
  }

  return {
    built: true,
    manifest: {
      handoffId: input.handoffId,
      sessionId: input.sessionId,
      sourceDeviceId: input.sourceDeviceId,
      destinationDeviceId: input.destinationDeviceId,
      inventory: inventory(input.record, input.runtime),
      integrity: input.integrity,
      offeredAt: input.offeredAt,
    },
  };
}
