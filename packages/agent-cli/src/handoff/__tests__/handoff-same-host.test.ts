/**
 * The hand-off test plan (TC-01…TC-10) end to end over a real carrier: two sessions on one host,
 * real sockets in the guarded rendezvous, the real grant signed with this device's key, the channel
 * grant gate, the receiving operator's approval, the file carrier for the payload, and the real wire
 * composition. Nothing here is a double of the protocol; only the operator and the store are scripted.
 */

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createUserMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { scriptedOperator } from '../../devices/__tests__/fake-secret-terminal.js';
import { createDeviceIdentityService } from '../../devices/device-identity-service.js';
import { loadDevicePrivateKeys } from '../../devices/identity-keys.js';
import { readIdentityState } from '../../devices/identity-state.js';
import {
  startLocalPeerMessaging,
  type IPeerMessaging,
} from '../../remote-control/local-peer-messaging.js';
import { createHandoffComposition } from '../handoff-composition-root.js';
import { localCarrierBinding, mintHandoffGrant, type IHandoffSigner } from '../handoff-grant.js';
import {
  createHandoffHostAdapter,
  describeHandoffArrival,
  localHandoffArrival,
  readHandoffIdentity,
  type IHandoffHostAdapterDeps,
} from '../handoff-host-adapter.js';
import { pushHandoff, type IPushHandoffOptions } from '../handoff-push.js';
import { createHandoffReceiver } from '../handoff-receiving.js';
import { openHandoffWire } from '../handoff-wire.js';

import type { TReceiveHandoffOutcome } from '../handoff-receive.js';
import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type {
  ICapabilityApprovalRequest,
  IFileFrameChannel,
  IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

const composition = createHandoffComposition();

let home: string;
let root: string;
let signer: IHandoffSigner;
let credentialStore: ICredentialStore;
let scratch: string;
let guardedDirectory: string;
const open: IPeerMessaging[] = [];

beforeAll(async () => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), 'handoff-home-')));
  root = path.join(home, '.robota');
  const store = createFileCredentialStore(path.join(root, 'credentials'), { withinRoot: root });
  credentialStore = store;
  const directory = path.join(root, 'devices');
  const service = createDeviceIdentityService({
    directory,
    withinRoot: root,
    store,
    openTerminal: () => scriptedOperator().session,
    defaultDeviceName: () => 'desk',
  });
  expect((await service.init({})).ok).toBe(true);
  const state = readIdentityState(directory);
  if (state === undefined) throw new Error('no identity');
  const keys = await loadDevicePrivateKeys(store, state.deviceCertificate);
  if (keys === undefined) throw new Error('no keys');
  signer = { userId: state.userId, signPrivateKey: keys.signPrivateKey };
}, 60_000);

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'handoff-')));
  guardedDirectory = path.join(scratch, 'rv');
  mkdirSync(guardedDirectory, { mode: 0o700 });
});

afterEach(async () => {
  for (const messaging of open.splice(0)) await messaging.close();
  rmSync(path.join(root, 'handoff'), { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function operator(answer: boolean): IOperatorApprover & { asked: ICapabilityApprovalRequest[] } {
  const asked: ICapabilityApprovalRequest[] = [];
  return {
    asked,
    approve: async (request) => {
      asked.push(request);
      return answer;
    },
  };
}

const alive = () => [
  { sessionId: 'A', liveness: 'alive' as const },
  { sessionId: 'B', liveness: 'alive' as const },
];

const ingress = {
  receive: vi.fn(async () => ({ ack: { id: '', sequence: 0, state: 'refused' as const } })),
};

function message(index: number, text: string): IInteractiveSessionRecord['messages'][number] {
  return {
    id: `m-${index}`,
    timestamp: new Date('2026-08-21T00:00:00.000Z'),
    state: 'complete',
    role: 'user',
    content: text,
  };
}

function record(messages = [message(0, 'move me')]): IInteractiveSessionRecord {
  return {
    id: 'session-1',
    cwd: '/home/user/project',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T01:00:00.000Z',
    messages,
  };
}

interface IDestinationOptions {
  readonly approver?: IOperatorApprover;
  readonly resolveCredential?: () => boolean;
  readonly persist?: (record: IInteractiveSessionRecord) => boolean;
  /** B takes hand-offs at all. */
  readonly takesHandoffs?: boolean;
}

/**
 * Two sessions, A (holding the session) and B, on real sockets. B takes hand-offs into `saved`;
 * A takes them too, so a pull aimed at A reaches a receiver that could take a session.
 */
async function sessions(options: IDestinationOptions = {}) {
  const saved: IInteractiveSessionRecord[] = [];
  const outcomes: TReceiveHandoffOutcome[] = [];
  const receiverFor = (approver: IOperatorApprover | undefined) => {
    const receive = createHandoffReceiver({
      root,
      composition,
      identity: () => readHandoffIdentity(root),
      resolveCredential: options.resolveCredential ?? (() => true),
      persist:
        options.persist ??
        ((kept) => {
          saved.push(kept);
          return true;
        }),
      deviceLabel: 'session B',
    });
    return (sessionId: string) => (sender: { sessionId: string }, channel: IFileFrameChannel) =>
      void receive(
        localHandoffArrival(
          { sessionId, root, ...(approver !== undefined ? { approver } : {}) },
          sender,
          channel,
        ),
      ).then((outcome) => outcomes.push(outcome));
  };
  const intoB = receiverFor(options.approver)('B');
  const b = await startLocalPeerMessaging({
    guardedDirectory,
    sessionId: 'B',
    ingress,
    list: alive,
    ...(options.takesHandoffs === false ? {} : { onHandoff: intoB }),
  });
  const intoA = receiverFor(operator(true))('A');
  const a = await startLocalPeerMessaging({
    guardedDirectory,
    sessionId: 'A',
    ingress,
    list: alive,
    onHandoff: intoA,
  });
  open.push(a, b);
  return { a, b, saved, outcomes };
}

function push(
  a: IPeerMessaging,
  overrides: Partial<IPushHandoffOptions> & { readonly session?: IInteractiveSessionRecord } = {},
) {
  const onReadOnly = vi.fn();
  const openChannel = vi.fn(() => a.openHandoffChannel('B'));
  const result = pushHandoff({
    composition,
    request: {
      handoffId: 'handoff-1',
      sessionId: 'session-1',
      sourceDeviceId: 'A',
      destinationDeviceId: 'B',
      record: overrides.session ?? record(),
      runtime: {},
      offeredAt: 1_700_000_000_000,
    },
    openChannel,
    carrierBinding: localCarrierBinding('B'),
    mintGrant: (manifest, fingerprint) =>
      mintHandoffGrant(signer, manifest, fingerprint, Date.now()),
    onReadOnly,
    ...overrides,
  });
  return { result, onReadOnly, openChannel };
}

/** A channel whose frames in either direction can be watched, changed or dropped. */
function tapped(
  inner: Promise<IFileFrameChannel>,
  tap: {
    readonly out?: (frame: string, channel: IFileFrameChannel) => string | undefined;
    readonly in?: (frame: string) => boolean;
  },
): Promise<IFileFrameChannel> {
  return inner.then((channel) => ({
    ...channel,
    send: (frame) => {
      const changed = tap.out === undefined ? frame : tap.out(frame, channel);
      if (changed !== undefined) channel.send(changed);
    },
    onFrame: (handler) =>
      channel.onFrame((frame) => ((tap.in?.(frame) ?? true) ? handler(frame) : undefined)),
  }));
}

const aside = (): string => path.join(root, 'handoff', 'local-A');
const keptAside = (): string[] => (existsSync(aside()) ? readdirSync(aside()) : []);

function manyMessages(): IInteractiveSessionRecord['messages'] {
  return Array.from({ length: 400 }, (_, index) => message(index, 'x'.repeat(200)));
}

describe('TC-10 / TC-01: a full hand-off between two sessions over the peer channel', () => {
  it('moves the session, saves it unstarted, and leaves only the destination in charge', async () => {
    const approver = operator(true);
    const { a, saved, outcomes } = await sessions({ approver });
    const { result, onReadOnly } = push(a);

    const { outcome, source } = await result;
    expect(outcome.phase).toBe('committed');
    expect(source.isAuthoritative()).toBe(false);
    expect(onReadOnly).toHaveBeenCalledTimes(1);

    // Saved exactly as sealed: the record crossed intact and decoded back to what was sent.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(record());
    // TC-01: the manifest arrived with its inventory and integrity.
    await expect.poll(() => outcomes.length).toBe(1);
    const arrived = outcomes[0];
    expect(arrived?.received).toBe(true);
    if (arrived?.received !== true) return;
    expect(arrived.manifest.integrity.byteLength).toBeGreaterThan(0);
    expect(arrived.manifest.inventory.map((item) => item.kind)).toContain('provider-credentials');
    expect(
      arrived.manifest.inventory.find((item) => item.kind === 'provider-credentials')?.disposition,
    ).toBe('never-transferred');

    // The operator at B was asked once, for this transfer.
    expect(approver.asked).toHaveLength(1);
    expect(approver.asked[0]).toMatchObject({ capability: 'handoff', scope: 'request' });
    // Nothing ran it: no turn reached either session, and nothing is left aside.
    expect(ingress.receive).not.toHaveBeenCalled();
    expect(keptAside()).toEqual([]);
  }, 30_000);

  it('keeps turnSource and driverId through the seal, the carrier and the decoder', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    const peerTurn = {
      ...message(1, 'from another session'),
      metadata: { driverId: 'peer:C', turnSource: 'peer' },
    };
    const session: IInteractiveSessionRecord = {
      ...record([message(0, 'mine'), peerTurn]),
      history: [
        messageToHistoryEntry(
          createUserMessage('from another session', {
            metadata: { driverId: 'peer:C', turnSource: 'peer' },
          }),
        ),
      ],
    };

    const { outcome } = await push(a, { session }).result;
    expect(outcome.phase).toBe('committed');
    expect(saved[0]?.messages[1]?.metadata).toEqual({ driverId: 'peer:C', turnSource: 'peer' });
    expect(JSON.stringify(saved[0]?.history)).toContain('"turnSource":"peer"');
    expect(JSON.stringify(saved[0]?.history)).toContain('"driverId":"peer:C"');
  }, 30_000);
});

describe('TC-02: the source lets go only on durable persistence', () => {
  it('sends no acknowledgement when the save did not land', async () => {
    const { a } = await sessions({ approver: operator(true), persist: () => false });
    const { result, onReadOnly } = push(a);
    const { outcome, source } = await result;
    expect(outcome.phase).toBe('abandoned');
    expect(outcome.refusal).toBe('destination-cannot-resume');
    expect(source.isAuthoritative()).toBe(true);
    expect(onReadOnly).not.toHaveBeenCalled();
    await expect.poll(() => keptAside(), { timeout: 10_000 }).toEqual([]);
  }, 30_000);
});

describe('TC-03: the connection drops while the payload is moving', () => {
  it('leaves the source in charge and nothing kept at the destination', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    let chunks = 0;
    const { result, onReadOnly } = push(a, {
      session: record(manyMessages()),
      openChannel: () =>
        tapped(a.openHandoffChannel('B'), {
          out: (frame, channel) => {
            if (frame.includes('"t":"file-chunk"')) {
              chunks += 1;
              if (chunks === 2) {
                channel.close();
                return undefined;
              }
            }
            return frame;
          },
        }),
    });
    const { outcome, source } = await result;
    expect(chunks).toBeGreaterThanOrEqual(2);
    expect(outcome.phase).not.toBe('committed');
    expect(source.isAuthoritative()).toBe(true);
    expect(onReadOnly).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    await expect.poll(() => keptAside(), { timeout: 10_000 }).toEqual([]);
  }, 30_000);
});

describe('TC-04 / TC-05: the acknowledgement is lost after the destination saved it', () => {
  it('keeps the source in charge; the re-delivered ack completes it; the same transfer again is not saved twice', async () => {
    const persisted: IInteractiveSessionRecord[] = [];
    const { a } = await sessions({
      approver: operator(true),
      persist: (kept) => {
        persisted.push(kept);
        return true;
      },
    });
    let lost: unknown;
    const first = push(a, {
      idleMs: 1_000,
      openChannel: () =>
        tapped(a.openHandoffChannel('B'), {
          in: (frame) => {
            if (!frame.includes('"t":"handoff-ack"')) return true;
            lost = JSON.parse(frame);
            return false;
          },
        }),
    });
    const { outcome, source } = await first.result;
    // The window: saved there, not heard here.
    expect(persisted).toHaveLength(1);
    expect(outcome.phase).not.toBe('committed');
    expect(source.isAuthoritative()).toBe(true);
    expect(first.onReadOnly).not.toHaveBeenCalled();

    // TC-04: the acknowledgement, delivered late, finishes the transfer — once.
    const ack = (lost as { ack: Parameters<typeof source.applyAck>[0] }).ack;
    expect(source.applyAck(ack).phase).toBe('committed');
    expect(source.applyAck(ack).phase).toBe('committed');
    expect(first.onReadOnly).toHaveBeenCalledTimes(1);

    // TC-05: the same hand-off pushed again is answered with the saved acknowledgement.
    const again = push(a);
    expect((await again.result).outcome.phase).toBe('committed');
    expect(persisted).toHaveLength(1);
  }, 30_000);
});

describe('TC-06: a corrupt payload', () => {
  it('is discarded by the carrier, never staged, and the source keeps the session', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    const { result, onReadOnly } = push(a, {
      openChannel: () =>
        tapped(a.openHandoffChannel('B'), {
          out: (frame) => {
            if (!frame.includes('"t":"file-chunk"')) return frame;
            const chunk = JSON.parse(frame) as { data: string };
            const bytes = Buffer.from(chunk.data, 'base64');
            bytes[0] = (bytes[0] ?? 0) ^ 0xff;
            return JSON.stringify({ ...chunk, data: bytes.toString('base64') });
          },
        }),
    });
    const { outcome, source } = await result;
    expect(outcome.refusal).toBe('integrity-failed');
    expect(source.isAuthoritative()).toBe(true);
    expect(onReadOnly).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    await expect.poll(() => keptAside(), { timeout: 10_000 }).toEqual([]);
  }, 30_000);
});

describe('TC-07: the destination has no provider credential of its own', () => {
  it('fails at commit, before anything is saved, with the source unaffected', async () => {
    const persist = vi.fn(() => true);
    const { a } = await sessions({
      approver: operator(true),
      resolveCredential: () => false,
      persist,
    });
    const { result, onReadOnly } = push(a);
    const { outcome, source } = await result;
    expect(outcome.refusal).toBe('destination-cannot-resume');
    expect(outcome.detail).toContain('SEC-009');
    expect(persist).not.toHaveBeenCalled();
    expect(source.isAuthoritative()).toBe(true);
    expect(onReadOnly).not.toHaveBeenCalled();
  }, 30_000);
});

describe('TC-08: a turn in flight', () => {
  it('is refused before any channel is opened', async () => {
    const { a } = await sessions({ approver: operator(true) });
    const { result, openChannel } = push(a, {
      request: {
        handoffId: 'handoff-1',
        sessionId: 'session-1',
        sourceDeviceId: 'A',
        destinationDeviceId: 'B',
        record: record(),
        runtime: { modelCallInFlight: true },
        offeredAt: 1,
      },
    });
    const { outcome, source } = await result;
    expect(outcome.refusal).toBe('in-flight-work');
    expect(openChannel).not.toHaveBeenCalled();
    expect(source.isAuthoritative()).toBe(true);
  });
});

describe('TC-09: every way the destination does not take it leaves the source in charge', () => {
  it('a receiver whose operator did not approve refuses, before a byte of the session moves', async () => {
    const approver = operator(false);
    const { a, saved } = await sessions({ approver });
    let payloadFrames = 0;
    const { result, onReadOnly } = push(a, {
      openChannel: () =>
        tapped(a.openHandoffChannel('B'), {
          out: (frame) => {
            if (frame.includes('"t":"file-')) payloadFrames += 1;
            return frame;
          },
        }),
    });
    const { outcome, source } = await result;
    expect(outcome.phase).toBe('abandoned');
    expect(outcome.detail).toContain('did not accept');
    expect(approver.asked).toHaveLength(1);
    expect(payloadFrames).toBe(0);
    expect(saved).toEqual([]);
    expect(source.isAuthoritative()).toBe(true);
    expect(onReadOnly).not.toHaveBeenCalled();
  }, 30_000);

  it('a receiver with nobody to ask refuses', async () => {
    const { a, saved } = await sessions({});
    const { outcome, source } = await push(a).result;
    expect(outcome.phase).toBe('abandoned');
    expect(saved).toEqual([]);
    expect(source.isAuthoritative()).toBe(true);
  }, 30_000);

  it('a session that takes no hand-offs refuses', async () => {
    const { a } = await sessions({ takesHandoffs: false });
    const { outcome, source } = await push(a).result;
    expect(outcome.phase).toBe('abandoned');
    expect(source.isAuthoritative()).toBe(true);
  }, 30_000);

  it('a grant bound to another channel is refused, and the operator is never asked', async () => {
    const approver = operator(true);
    const { a, saved } = await sessions({ approver });
    const { outcome, source } = await push(a, { carrierBinding: localCarrierBinding('C') }).result;
    expect(outcome.refusal).toBe('unauthorized');
    expect(outcome.detail).toContain('channel-substituted');
    expect(approver.asked).toHaveLength(0);
    expect(saved).toEqual([]);
    expect(source.isAuthoritative()).toBe(true);
  }, 30_000);
});

describe('push-only', () => {
  it('refuses a destination asking for the session, and sends it nothing', async () => {
    const { b, outcomes } = await sessions({ approver: operator(true) });
    // B, a confirmed session of this user, opens a hand-off channel to A and asks for A's session.
    const wire = openHandoffWire(await b.openHandoffChannel('A'));
    wire.send({ t: 'handoff-pull' });
    const answer = await wire.next(5_000);
    expect(answer).toMatchObject({ t: 'handoff-refuse', reason: 'push-only' });
    expect(answer.t === 'handoff-refuse' && answer.detail).toContain('/handoff');
    // Nothing else comes: the channel ends with no session on it.
    await expect(wire.next(10_000)).rejects.toThrow(/ended/);
    wire.close();
    await expect.poll(() => outcomes.length).toBe(1);
    expect(outcomes[0]).toMatchObject({ received: false, reason: 'push-only' });
  }, 30_000);
});

describe('the /handoff adapter over the peer channel', () => {
  function adapter(a: IPeerMessaging, overrides: Partial<IHandoffHostAdapterDeps> = {}) {
    const onHandedOff = vi.fn();
    const stored = record();
    const deps: IHandoffHostAdapterDeps = {
      root,
      store: credentialStore,
      composition,
      sessionStore: {
        load: (id) =>
          id === stored.id ? { status: 'valid', record: stored } : { status: 'missing' },
        save: () => {},
        list: () => [],
        delete: () => {},
      },
      getSession: () => ({
        getSessionId: () => 'session-1',
        getCwd: () => scratch,
        isExecuting: () => false,
        listBackgroundTasks: () => [{ status: 'running' }, { status: 'completed' }],
      }),
      peers: { list: alive, ownSessionId: () => 'A' },
      openChannel: () => (target) => a.openHandoffChannel(target),
      onHandedOff,
      uncommittedChanges: async () => true,
      ...overrides,
    };
    return { handoff: createHandoffHostAdapter(deps), onHandedOff };
  }

  it('lists the other sessions, and what stays behind', async () => {
    const { a } = await sessions({ approver: operator(true) });
    const { handoff } = adapter(a);
    expect(await handoff.destinations()).toEqual([
      { deviceId: 'B', name: 'another session on this machine' },
    ]);
    expect(await handoff.staysBehind()).toEqual({ uncommittedChanges: true, subprocesses: 1 });
  }, 30_000);

  it('moves the session, then ends this one and refuses a second move', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    const { handoff, onHandedOff } = adapter(a);
    const progress: string[] = [];
    const final = await handoff.transfer('B', (step) => progress.push(step.state));
    expect(final).toEqual({ state: 'done', stillMine: false });
    expect(progress).toEqual(['offered', 'sending', 'awaiting-confirmation']);
    expect(saved).toHaveLength(1);
    expect(onHandedOff).toHaveBeenCalledTimes(1);
    expect(handoff.status().stillMine).toBe(false);
    expect(await handoff.transfer('B')).toEqual({ state: 'done', stillMine: false });
    expect(saved).toHaveLength(1);
  }, 30_000);

  it('says which command to run when this device has no identity to sign with', async () => {
    const { a } = await sessions({ approver: operator(true) });
    const { handoff, onHandedOff } = adapter(a, { root: path.join(scratch, 'no-identity') });
    const final = await handoff.transfer('B');
    expect(final.stillMine).toBe(true);
    expect(final.reason).toContain('/devices init');
    expect(onHandedOff).not.toHaveBeenCalled();
  }, 30_000);

  it('keeps the session when the other side refuses it', async () => {
    const { a } = await sessions({ approver: operator(false) });
    const { handoff, onHandedOff } = adapter(a);
    const final = await handoff.transfer('B');
    expect(final.state).toBe('stopped');
    expect(final.stillMine).toBe(true);
    expect(onHandedOff).not.toHaveBeenCalled();
  }, 30_000);

  it('tells the receiving operator the session is saved, not started, and how to resume it', () => {
    const said = describeHandoffArrival(
      'A',
      { received: true, manifest: { sessionId: 'session-1' } as never, record: record() },
      (id) => `robota --resume ${id}`,
    );
    expect(said).toContain('was not started');
    expect(said).toContain('robota --resume session-1');
  });
});
