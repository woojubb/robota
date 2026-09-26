/**
 * `/handoff` at the composition root, over the same-host peer channel or a device-mesh link: push
 * this session to another session of this user on this machine or to another of the user's devices,
 * and take a session another one pushes here.
 *
 * The session given away is the one this process last saved — a hand-off needs a settled session,
 * and a settled session has been saved after its last turn. The grant is signed with this device's
 * key, so a hand-off needs this device's identity. Once the other session has saved it, this process
 * ends: two processes running one conversation is the ambiguity a hand-off exists to prevent.
 *
 * A session taken here is saved into this session's project and not started; the operator resumes it.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { findProviderDefinition, getProviderCredentialRequirement } from '@robota-sdk/agent-core';
import {
  ConnectionAuthority,
  assessHandoffReadiness,
} from '@robota-sdk/agent-interface-session-mobility';

import { loadDevicePrivateKeys } from '../devices/identity-keys.js';
import { readIdentityState } from '../devices/identity-state.js';
import { localCarrierBinding, mintHandoffGrant, type IHandoffSigner } from './handoff-grant.js';
import { pushHandoff, type IPushHandoffOptions, type IPushHandoffResult } from './handoff-push.js';
import { runLocalGit } from '../remote-control/local-peer-workspace.js';

import type { IHandoffReceiverIdentity, IHandoffArrival } from './handoff-receiving.js';
import type { TReceiveHandoffOutcome } from './handoff-receive.js';
import type { IPeerSender } from '../remote-control/local-peer-channel.js';
import type {
  ICredentialStore,
  IProviderDefinition,
  IProviderDefinitionConfig,
} from '@robota-sdk/agent-core';
import type {
  ICommandHandoffAdapter,
  IHandoffProgress,
  IHandoffStaysBehind,
} from '@robota-sdk/agent-framework';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import type {
  IFileFrameChannel,
  IHandoffComposition,
  IHandoffManifestRequest,
  IHandoffOutcome,
  IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

/** What `/handoff` reads of the live session. */
export interface IHandoffSourceSession {
  getSessionId(): string;
  getCwd(): string;
  isExecuting(): boolean;
  listBackgroundTasks?(): readonly { readonly status: string }[];
}

/** Background work that is still going, and so stays behind. */
const LIVE_TASK = new Set(['queued', 'running', 'waiting_permission', 'sleeping', 'paused']);

/** This device's identity, as a hand-off reads it: who it is, and the certificates it holds. */
export function readHandoffIdentity(
  root: string,
): (IHandoffReceiverIdentity & { readonly deviceId: string }) | undefined {
  const state = readIdentityState(join(root, 'devices'));
  if (state === undefined) return undefined;
  const own = state.deviceCertificate;
  return {
    userId: state.userId,
    deviceId: own.deviceId,
    certificateOf: (deviceId) =>
      deviceId === own.deviceId
        ? own
        : state.roster.devices.find((certificate) => certificate.deviceId === deviceId),
  };
}

/**
 * Whether this machine's own provider configuration carries the credential its provider needs. A
 * session handed over brings none, so a machine without one cannot take it on.
 */
export function providerHasOwnCredential(
  settings: Pick<IProviderDefinitionConfig, 'name' | 'apiKey'>,
  definitions: readonly IProviderDefinition[],
): boolean {
  const requirement = getProviderCredentialRequirement(
    findProviderDefinition(definitions, settings.name),
  );
  return requirement === undefined || (settings.apiKey ?? '') !== '';
}

/** Whether the working tree has changes a hand-off leaves behind. Unknown reads as none. */
async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const result = await runLocalGit(cwd, ['status', '--porcelain']);
  return result !== undefined && result.code === 0 && result.stdout !== '';
}

export interface IHandoffHostAdapterDeps {
  /** `~/.robota` of this `HOME`. */
  readonly root: string;
  readonly store: ICredentialStore;
  readonly composition: IHandoffComposition;
  readonly sessionStore: IInteractiveSessionStore;
  /** The live session, once there is one. */
  readonly getSession: () => IHandoffSourceSession | undefined;
  /** Other sessions on this machine, and this one's own id among them. */
  readonly peers: {
    list(): readonly { readonly sessionId: string; readonly liveness: string }[];
    ownSessionId(): string;
  };
  /** Opens a channel to another announced session; absent until messaging is up. */
  readonly openChannel: () => ((targetSessionId: string) => Promise<IFileFrameChannel>) | undefined;
  /** The user's other devices linked over the device mesh. Absent: sessions on this machine only. */
  readonly devices?: {
    list(): readonly { readonly deviceId: string; readonly name?: string }[];
    /** Push over the device's link; rejects when it is no longer linked. */
    push(
      deviceId: string,
      options: Omit<IPushHandoffOptions, 'openChannel' | 'carrierBinding'>,
    ): Promise<IPushHandoffResult>;
  };
  /** The session has moved: end this process through its normal end-of-life. */
  readonly onHandedOff: () => void;
  readonly now?: () => number;
  /** How long to wait between frames; test seam. */
  readonly idleMs?: number;
  /** Test seam; production reads git. */
  readonly uncommittedChanges?: (cwd: string) => Promise<boolean>;
}

async function loadSigner(
  root: string,
  store: ICredentialStore,
): Promise<(IHandoffSigner & { readonly deviceId: string }) | undefined> {
  const state = readIdentityState(join(root, 'devices'));
  if (state === undefined) return undefined;
  const keys = await loadDevicePrivateKeys(store, state.deviceCertificate);
  return keys === undefined
    ? undefined
    : {
        userId: state.userId,
        signPrivateKey: keys.signPrivateKey,
        deviceId: state.deviceCertificate.deviceId,
      };
}

/** Whether two saved snapshots of one session are the same state of it. */
function sameSnapshot(a: IInteractiveSessionRecord, b: IInteractiveSessionRecord): boolean {
  return (
    a.id === b.id &&
    a.updatedAt === b.updatedAt &&
    a.messages.length === b.messages.length &&
    (a.history?.length ?? 0) === (b.history?.length ?? 0)
  );
}

function stopped(reason: string): IHandoffProgress {
  return { state: 'stopped', reason, stillMine: true };
}

function describeOutcome(outcome: IHandoffOutcome): IHandoffProgress {
  if (outcome.phase === 'committed') return { state: 'done', stillMine: false };
  return stopped(outcome.detail ?? outcome.refusal ?? 'the transfer did not complete');
}

/** The `/handoff` adapter over the same-host peer channel. */
export function createHandoffHostAdapter(deps: IHandoffHostAdapterDeps): ICommandHandoffAdapter {
  const now = deps.now ?? Date.now;
  const uncommitted = deps.uncommittedChanges ?? hasUncommittedChanges;
  let current: IHandoffProgress = { state: 'offered', stillMine: true };
  let busy = false;
  /** A transfer sent whose answer never came: the receiver may have saved it. */
  let unsettled:
    | {
        readonly target: string;
        readonly request: IHandoffManifestRequest;
        readonly toDevice: boolean;
      }
    | undefined;

  const staysBehind = async (): Promise<IHandoffStaysBehind> => {
    const session = deps.getSession();
    if (session === undefined) return { uncommittedChanges: false, subprocesses: 0 };
    const tasks = session.listBackgroundTasks?.() ?? [];
    return {
      uncommittedChanges: await uncommitted(session.getCwd()),
      subprocesses: tasks.filter((task) => LIVE_TASK.has(task.status)).length,
    };
  };

  const transfer = async (
    target: string,
    onProgress?: (progress: IHandoffProgress) => void,
  ): Promise<IHandoffProgress> => {
    if (unsettled !== undefined && unsettled.target !== target) {
      return stopped(
        `an earlier hand-off to ${unsettled.target} was not confirmed and may already be saved ` +
          `there; run /handoff ${unsettled.target} to settle it first`,
      );
    }
    const session = deps.getSession();
    // An unconfirmed transfer is settled over the carrier it went by.
    const toDevice =
      unsettled?.target === target
        ? unsettled.toDevice
        : deps.devices?.list().some((device) => device.deviceId === target) === true;
    const open = toDevice ? undefined : deps.openChannel();
    if (session === undefined || (!toDevice && open === undefined)) {
      return stopped('this session cannot reach other sessions yet');
    }
    const signer = await loadSigner(deps.root, deps.store);
    if (signer === undefined) {
      return stopped(
        'this device has no identity to sign the hand-off with; run `/devices init` first',
      );
    }
    const loaded = deps.sessionStore.load(session.getSessionId());
    if (loaded.status !== 'valid') {
      return stopped('this session has nothing saved to hand off yet');
    }
    const record: IInteractiveSessionRecord = loaded.record;
    const behind = await staysBehind();
    const report = (state: IHandoffProgress['state']): void => {
      current = { state, stillMine: true };
      onProgress?.(current);
    };
    const runtime = {
      modelCallInFlight: session.isExecuting(),
      subprocesses: behind.subprocesses,
      uncommittedChanges: behind.uncommittedChanges,
    };
    // Settled now, not when the first attempt was made: a resend is refused mid-turn like any offer.
    const readiness = assessHandoffReadiness(runtime);
    if (!readiness.ready) return stopped(readiness.detail);
    if (unsettled !== undefined && !sameSnapshot(unsettled.request.record, record)) {
      // The session moved on since the copy that may already be saved there, so that copy is not
      // resent. The operator is told once; the next /handoff is a new transfer of the current state.
      unsettled = undefined;
      current = stopped(
        `this session changed since the hand-off to ${target} that was not confirmed, so ${target} ` +
          'may hold an older copy of it. Check it there; /handoff again sends the current session ' +
          'as a new transfer',
      );
      return current;
    }
    // A transfer whose answer was lost is sent again as itself, so a receiver that already saved it
    // answers with the same acknowledgement instead of saving a second copy. What stays behind is
    // reported as it is now: background work may have ended, or changes been committed, since then.
    const request: IHandoffManifestRequest =
      unsettled !== undefined
        ? { ...unsettled.request, runtime }
        : {
            handoffId: randomUUID(),
            sessionId: record.id,
            // Between devices each end is its device; between sessions on this machine, its session.
            sourceDeviceId: toDevice ? signer.deviceId : deps.peers.ownSessionId(),
            destinationDeviceId: target,
            record,
            runtime,
            offeredAt: now(),
          };
    const options: Omit<IPushHandoffOptions, 'openChannel' | 'carrierBinding'> = {
      composition: deps.composition,
      request,
      mintGrant: (manifest, fingerprint) => mintHandoffGrant(signer, manifest, fingerprint, now()),
      onReadOnly: () => {
        current = { state: 'done', stillMine: false };
      },
      onProgress: report,
      ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
    };
    let outcome: IHandoffOutcome;
    if (open !== undefined) {
      ({ outcome } = await pushHandoff({
        ...options,
        openChannel: () => open(target),
        carrierBinding: localCarrierBinding(target),
      }));
    } else {
      const devices = deps.devices;
      if (devices === undefined) return stopped(`${target} is not linked`);
      try {
        ({ outcome } = await devices.push(target, options));
      } catch (error) {
        // Nothing was offered: the device's link went away before the transfer could start.
        return stopped(error instanceof Error ? error.message : String(error));
      }
    }
    const waiting = outcome.phase === 'transferring' || outcome.phase === 'staged';
    unsettled = waiting ? { target, request, toDevice } : undefined;
    current = waiting
      ? stopped(
          `${target} did not confirm; it may already have saved the session. ` +
            `Run /handoff ${target} again to settle it`,
        )
      : describeOutcome(outcome);
    if (!current.stillMine) deps.onHandedOff();
    return current;
  };

  return {
    destinations: async () => [
      ...deps.peers
        .list()
        .filter((peer) => peer.sessionId !== deps.peers.ownSessionId() && peer.liveness !== 'dead')
        .map((peer) => ({ deviceId: peer.sessionId, name: 'another session on this machine' })),
      ...(deps.devices?.list() ?? []).map((device) => ({
        deviceId: device.deviceId,
        name: `${device.name ?? 'unnamed'}, another of your devices`,
      })),
    ],
    staysBehind,
    transfer: async (target, onProgress) => {
      if (busy) return stopped('a hand-off is already in progress');
      if (!current.stillMine) return current;
      busy = true;
      try {
        return await transfer(target, onProgress);
      } finally {
        busy = false;
      }
    },
    status: () => current,
  };
}

export interface ILocalHandoffArrivalDeps {
  /** This session's id on this machine. */
  readonly sessionId: string;
  readonly root: string;
  readonly approver?: IOperatorApprover;
}

/**
 * A hand-off another session on this machine pushed, as the receiver takes it: bound to this
 * session's socket, signed by this device's key, and put to the operator here.
 */
export function localHandoffArrival(
  deps: ILocalHandoffArrivalDeps,
  sender: IPeerSender,
  channel: IFileFrameChannel,
): IHandoffArrival {
  const identity = readHandoffIdentity(deps.root);
  return {
    channel,
    carrierBinding: localCarrierBinding(deps.sessionId),
    destinationId: deps.sessionId,
    sourceId: sender.sessionId,
    // Both sessions run under this device's identity: its key signs, its certificate verifies.
    // Without an identity no certificate verifies the grant, and the hand-off is refused.
    signerDeviceId: identity?.deviceId ?? '',
    senderDirectory: `local-${sender.sessionId}`,
    authority: new ConnectionAuthority(
      { sessionId: sender.sessionId, locality: 'same-host', capabilities: ['handoff'] },
      deps.approver,
    ),
  };
}

/** What the operator is told about a session another session pushed here. */
export function describeHandoffArrival(
  from: string,
  outcome: TReceiveHandoffOutcome,
  formatResume: (sessionId: string) => string,
): string {
  if (!outcome.received) {
    return `[handoff] a session from ${from} was not taken: ${outcome.detail}.`;
  }
  const id = outcome.record?.id ?? outcome.manifest.sessionId;
  return (
    `[handoff] session ${id} from ${from} is saved here and was not started. ` +
    `Resume it with: ${formatResume(id)}`
  );
}
