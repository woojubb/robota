/**
 * The hand-off test plan end to end over a real carrier: two sessions on one host,
 * real sockets in the guarded rendezvous, the real grant signed with this device's key, the channel
 * grant gate, the receiving operator's approval, the file carrier for the payload, and the real wire
 * composition. Nothing here is a double of the protocol; only the operator and the store are scripted.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createUserMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { scriptedOperator } from '../../devices/__tests__/fake-secret-terminal.js';
import { createDeviceIdentityService } from '../../devices/device-identity-service.js';
import { createTestRuntimeContext } from '../../devices/__tests__/runtime-context-fixture.js';
import { loadDevicePrivateKeys } from '../../devices/identity-keys.js';
import { readIdentityState } from '../../devices/identity-state.js';
import { overrideProductSecureMode, useProductKeyHolder } from '../../product/session-sealing.js';
import {
  startLocalPeerMessaging,
  type IPeerMessaging,
} from '../../remote-control/local-peer-messaging.js';
import { KeyHolder } from '@robota-sdk/agent-local-host';
import { createMemoryKeyringStore, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { createHandoffComposition } from '../handoff-composition-root.js';
import {
  checkHandoffGrant,
  handoffChannelFingerprint,
  localCarrierBinding,
  mintHandoffGrant,
  type IHandoffSigner,
} from '../handoff-grant.js';
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
import type { ICliRuntimeContext } from '../../product/runtime-context.js';
import type { ICredentialStore } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface/session';
import type {
  ICapabilityApprovalRequest,
  IFileFrameChannel,
  IHandoffManifest,
  IOperatorApprover,
} from '@robota-sdk/agent-interface/session-mobility';

/** Every memory sink the receivers made, so a test can tell whether one still holds a session. */
const memorySinks = vi.hoisted(() => [] as { take(): Buffer }[]);

vi.mock('../../peer-files/quarantine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../peer-files/quarantine.js')>();
  return {
    ...actual,
    createMemoryFileSink: (...args: Parameters<typeof actual.createMemoryFileSink>) => {
      const sink = actual.createMemoryFileSink(...args);
      memorySinks.push(sink);
      return sink;
    },
  };
});

const composition = createHandoffComposition();

let home: string;
let root: string;
let productRuntime: ReturnType<typeof createTestRuntimeContext>;
let signer: IHandoffSigner;
let credentialStore: ICredentialStore;
let scratch: string;
let guardedDirectory: string;
const open: IPeerMessaging[] = [];

beforeAll(async () => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), 'handoff-home-')));
  root = path.join(home, '.agent-fixture');
  productRuntime = createTestRuntimeContext(root);
  const store = createFileCredentialStore(path.join(root, 'credentials'), { withinRoot: root });
  credentialStore = store;
  const directory = path.join(root, 'devices');
  const service = createDeviceIdentityService({
    productRuntime,
    directory,
    withinRoot: root,
    store,
    openTerminal: () => scriptedOperator().session,
    defaultDeviceName: () => 'desk',
  });
  expect((await service.init({})).ok).toBe(true);
  const state = readIdentityState(productRuntime.cryptoContext, directory);
  if (state === undefined) throw new Error('no identity');
  const keys = await loadDevicePrivateKeys(store, productRuntime.config.credentials.serviceNamespace, state.deviceCertificate);
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

describe('handoff product crypto domains', () => {
  it('rejects a grant signed with the same key under another product context', async () => {
    const state = readIdentityState(productRuntime.cryptoContext, path.join(root, 'devices'));
    if (state === undefined) throw new Error('no identity');
    const alternate = createTestRuntimeContext(root, 'another-test-agent-domain');
    const manifest: IHandoffManifest = {
      handoffId: 'domain-check',
      sessionId: 'session-1',
      sourceDeviceId: state.deviceCertificate.deviceId,
      destinationDeviceId: 'destination-device',
      inventory: [],
      integrity: { digest: 'A'.repeat(43), byteLength: 0 },
      offeredAt: Date.now(),
    };
    const now = Date.now();
    const channelA = handoffChannelFingerprint(productRuntime.cryptoContext, 'local:B', 'nonce');
    const channelB = handoffChannelFingerprint(alternate.cryptoContext, 'local:B', 'nonce');
    const grant = await mintHandoffGrant(
      productRuntime.cryptoContext,
      signer,
      manifest,
      channelA,
      now,
    );
    const check = {
      sender: state.deviceCertificate,
      sourceId: manifest.sourceDeviceId,
      userId: signer.userId,
      manifest,
      destinationId: manifest.destinationDeviceId,
      channelFingerprint: channelA,
      now,
      seenNonces: new Set<string>(),
    };

    expect(channelA).not.toBe(channelB);
    expect((await checkHandoffGrant(productRuntime.cryptoContext, grant, check)).admitted).toBe(true);
    const crossProduct = await checkHandoffGrant(alternate.cryptoContext, grant, {
      ...check,
      seenNonces: new Set<string>(),
    });
    expect(crossProduct).toMatchObject({ admitted: false, reason: 'the grant was refused: signature-invalid' });
  });
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
  /** The runtime the receivers decide with; the file's own by default. */
  readonly receiverRuntime?: ICliRuntimeContext;
  /** What B's receiver sees of each hand-off channel; the channel itself by default. */
  readonly receiverChannel?: (channel: IFileFrameChannel) => IFileFrameChannel;
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
      productRuntime: options.receiverRuntime ?? productRuntime,
      root,
      composition,
      identity: () => readHandoffIdentity(root, productRuntime),
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
          { sessionId, root, productRuntime, ...(approver !== undefined ? { approver } : {}) },
          sender,
          options.receiverChannel?.(channel) ?? channel,
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
    cryptoContext: productRuntime.cryptoContext,
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
      mintHandoffGrant(productRuntime.cryptoContext, signer, manifest, fingerprint, Date.now()),
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

describe('a full hand-off between two sessions over the peer channel', () => {
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
    // The manifest arrived with its inventory and integrity.
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

describe('where the payload waits until it is saved', () => {
  const CANARY = 'CANARY-handoff-3e7a-what-the-session-said';

  /** Every file under this test's home and scratch roots whose bytes hold `needle`. */
  function filesHolding(needle: string): string[] {
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.isFile() && readFileSync(full).includes(Buffer.from(needle)) ? [full] : [];
      });
    return [home, scratch].flatMap(walk);
  }

  /** Pushes a session holding the canary, and looks at the disk while B saves it. */
  async function pushCanary(receiverRuntime?: ICliRuntimeContext) {
    const kept: IInteractiveSessionRecord[] = [];
    let duringSave: { readonly holding: string[]; readonly handoffArea: boolean } | undefined;
    const { a } = await sessions({
      approver: operator(true),
      ...(receiverRuntime !== undefined ? { receiverRuntime } : {}),
      persist: (session) => {
        duringSave = {
          holding: filesHolding(CANARY),
          handoffArea: existsSync(path.join(root, 'handoff')),
        };
        kept.push(session);
        return true;
      },
    });
    const { outcome } = await push(a, { session: record([message(0, CANARY)]) }).result;
    expect(outcome.phase).toBe('committed');
    expect(kept.map((session) => session.messages[0]?.content)).toEqual([CANARY]);
    return { duringSave };
  }

  it('is a file in the aside directory, under the hand-off id, while records are kept plain', async () => {
    const { duringSave } = await pushCanary();

    expect(duringSave).toEqual({
      holding: [path.join(aside(), 'handoff-1.json')],
      handoffArea: true,
    });
    await expect.poll(() => keptAside(), { timeout: 10_000 }).toEqual([]);
  }, 30_000);

  async function sealingRuntime(): Promise<ICliRuntimeContext> {
    const { keyring } = await fixtureKeyring();
    const runtime = createTestRuntimeContext(root);
    overrideProductSecureMode(runtime, true);
    useProductKeyHolder(
      runtime,
      new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } }),
    );
    return runtime;
  }

  it('is memory alone once records are sealed: nothing on disk holds it, and the aside directory is never made', async () => {
    const { duringSave } = await pushCanary(await sealingRuntime());

    expect(duringSave).toEqual({ holding: [], handoffArea: false });
    expect(filesHolding(CANARY)).toEqual([]);
    expect(existsSync(path.join(root, 'handoff'))).toBe(false);
  }, 30_000);

  it('is not held in memory once the transfer fails after the payload was committed', async () => {
    memorySinks.length = 0;
    const { a, saved, outcomes } = await sessions({
      approver: operator(true),
      receiverRuntime: await sealingRuntime(),
      // The verified payload is committed, then telling the source so fails.
      receiverChannel: (channel) => ({
        ...channel,
        send: (frame) => {
          if (frame.includes('"t":"file-done"')) throw new Error('the connection closed');
          channel.send(frame);
        },
      }),
    });

    const { outcome } = await push(a, { session: record([message(0, CANARY)]) }).result;

    expect(outcome.phase).not.toBe('committed');
    await expect.poll(() => outcomes.length, { timeout: 10_000 }).toBe(1);
    expect(outcomes[0]).toMatchObject({ received: false });
    expect(saved).toEqual([]);
    expect(memorySinks).toHaveLength(1);
    expect(() => memorySinks[0]!.take()).toThrow('The memory sink holds no committed content.');
  }, 30_000);
});

describe('the source lets go only on durable persistence', () => {
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

describe('the connection drops while the payload is moving', () => {
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

describe('the acknowledgement is lost after the destination saved it', () => {
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

    // The acknowledgement, delivered late, finishes the transfer — once.
    const ack = (lost as { ack: Parameters<typeof source.applyAck>[0] }).ack;
    expect(source.applyAck(ack).phase).toBe('committed');
    expect(source.applyAck(ack).phase).toBe('committed');
    expect(first.onReadOnly).toHaveBeenCalledTimes(1);

    // The same hand-off pushed again is answered with the saved acknowledgement.
    const again = push(a);
    expect((await again.result).outcome.phase).toBe('committed');
    expect(persisted).toHaveLength(1);
  }, 30_000);
});

describe('a corrupt payload', () => {
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

describe('the destination has no provider credential of its own', () => {
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
    expect(outcome.detail).toContain('never transferred');
    expect(persist).not.toHaveBeenCalled();
    expect(source.isAuthoritative()).toBe(true);
    expect(onReadOnly).not.toHaveBeenCalled();
  }, 30_000);
});

describe('a turn in flight', () => {
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

describe('every way the destination does not take it leaves the source in charge', () => {
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
      productRuntime,
      root,
      store: credentialStore,
      composition,
      sessionStore: withHoldReadClaim({
        load: (id: string): TSessionLoadOutcome =>
          id === stored.id ? { status: 'valid', record: stored } : { status: 'missing' },
        save: () => {},
        list: () => [],
        delete: () => {},
      }),
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

  it('tells a sealed, locked session from one with nothing saved, and sends nothing for either', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    const store = (outcome: TSessionLoadOutcome) =>
      withHoldReadClaim({
        load: () => outcome,
        save: () => {},
        list: () => [],
        delete: () => {},
      });

    const locked = await adapter(a, { sessionStore: store({ status: 'locked' }) }).handoff.transfer(
      'B',
    );
    expect(locked).toMatchObject({
      stillMine: true,
      reason: 'this session is sealed and locked; unlock to hand it off',
    });
    // No unlock in this process opens a session sealed with keys it does not have.
    const noKeys = await adapter(a, {
      sessionStore: store({ status: 'locked', reason: 'no-keys' }),
    }).handoff.transfer('B');
    expect(noKeys).toMatchObject({
      stillMine: true,
      reason:
        'this session is sealed with keys this process does not have, so it cannot be handed off',
    });
    const missing = await adapter(a, {
      sessionStore: store({ status: 'missing' }),
    }).handoff.transfer('B');
    expect(missing).toMatchObject({
      stillMine: true,
      reason: 'this session has nothing saved to hand off yet',
    });
    expect(saved).toHaveLength(0);
  }, 30_000);

  it('lists the devices linked over the device mesh beside the sessions', async () => {
    const { a } = await sessions({ approver: operator(true) });
    const { handoff } = adapter(a, {
      devices: { list: () => [{ deviceId: 'D1', name: 'desktop' }], push: vi.fn() },
    });
    expect(await handoff.destinations()).toEqual([
      { deviceId: 'B', name: 'another session on this machine' },
      { deviceId: 'D1', name: 'desktop, another of your devices' },
    ]);
  }, 30_000);

  it('pushes to a linked device over its mesh link, from this device', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    const push = vi.fn(
      async (
        _deviceId: string,
        options: Omit<IPushHandoffOptions, 'openChannel' | 'carrierBinding'>,
      ) => {
        options.onReadOnly();
        return { outcome: { phase: 'committed' }, source: {} } as never;
      },
    );
    const { handoff, onHandedOff } = adapter(a, {
      devices: { list: () => [{ deviceId: 'D1', name: 'desktop' }], push },
    });
    const final = await handoff.transfer('D1');
    expect(final).toEqual({ state: 'done', stillMine: false });
    expect(push).toHaveBeenCalledTimes(1);
    const [target, options] = push.mock.calls[0]!;
    expect(target).toBe('D1');
    expect(options.request).toMatchObject({
      sourceDeviceId: readIdentityState(productRuntime.cryptoContext, path.join(root, 'devices'))?.deviceCertificate.deviceId,
      destinationDeviceId: 'D1',
      sessionId: 'session-1',
    });
    expect(saved).toHaveLength(0);
    expect(onHandedOff).toHaveBeenCalledTimes(1);
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

  it('when the confirmation is lost, says so, and the next /handoff settles the same transfer', async () => {
    const { a, saved } = await sessions({ approver: operator(true) });
    let dropAck = true;
    const { handoff, onHandedOff } = adapter(a, {
      idleMs: 1_000,
      openChannel: () => (target) =>
        tapped(a.openHandoffChannel(target), {
          in: (frame) => !(dropAck && frame.includes('"t":"handoff-ack"')),
        }),
    });
    const first = await handoff.transfer('B');
    expect(first.stillMine).toBe(true);
    expect(first.reason).toContain('may already have saved');
    expect(first.reason).toContain('/handoff B');
    expect(saved).toHaveLength(1);
    expect(onHandedOff).not.toHaveBeenCalled();

    // Another destination is refused until this one is settled.
    expect((await handoff.transfer('C')).reason).toContain('/handoff B');

    dropAck = false;
    expect(await handoff.transfer('B')).toEqual({ state: 'done', stillMine: false });
    expect(saved).toHaveLength(1);
    expect(onHandedOff).toHaveBeenCalledTimes(1);
  }, 30_000);

  /** An adapter whose first push loses its ack; the live session can then be changed. */
  async function afterLostAck() {
    const { a, saved } = await sessions({ approver: operator(true) });
    let dropAck = true;
    let executing = false;
    let stored = record();
    const { handoff, onHandedOff } = adapter(a, {
      idleMs: 1_000,
      sessionStore: withHoldReadClaim({
        load: (id: string): TSessionLoadOutcome =>
          id === stored.id ? { status: 'valid', record: stored } : { status: 'missing' },
        save: () => {},
        list: () => [],
        delete: () => {},
      }),
      getSession: () => ({
        getSessionId: () => 'session-1',
        getCwd: () => scratch,
        isExecuting: () => executing,
      }),
      openChannel: () => (target) =>
        tapped(a.openHandoffChannel(target), {
          in: (frame) => !(dropAck && frame.includes('"t":"handoff-ack"')),
        }),
    });
    expect((await handoff.transfer('B')).stillMine).toBe(true);
    dropAck = false;
    return {
      handoff,
      onHandedOff,
      saved,
      setExecuting: (value: boolean) => (executing = value),
      setStored: (next: IInteractiveSessionRecord) => (stored = next),
    };
  }

  it('does not resend while a turn is running: readiness is checked again', async () => {
    const { handoff, onHandedOff, saved, setExecuting } = await afterLostAck();
    setExecuting(true);
    const again = await handoff.transfer('B');
    expect(again.stillMine).toBe(true);
    expect(again.reason).toContain('turn is still running');
    expect(saved).toHaveLength(1);
    expect(onHandedOff).not.toHaveBeenCalled();
  }, 30_000);

  it('does not resend an older copy once the session moved on, and says the other side may hold it', async () => {
    const { handoff, onHandedOff, saved, setStored } = await afterLostAck();
    setStored({
      ...record([message(0, 'move me'), message(1, 'a later turn')]),
      updatedAt: '2026-08-21T02:00:00.000Z',
    });
    const again = await handoff.transfer('B');
    expect(again.stillMine).toBe(true);
    expect(again.reason).toContain('older copy');
    expect(saved).toHaveLength(1);
    expect(onHandedOff).not.toHaveBeenCalled();
    // Told once; the next /handoff sends the current session as a new transfer.
    expect(await handoff.transfer('B')).toEqual({ state: 'done', stillMine: false });
    expect(saved).toHaveLength(2);
    expect(saved[1]?.messages).toHaveLength(2);
  }, 30_000);

  it('after refusing to resend an older copy, status() reports that refusal, not the lost confirmation', async () => {
    const { handoff, setStored } = await afterLostAck();
    expect(handoff.status().reason).toContain('did not confirm');
    setStored({
      ...record([message(0, 'move me'), message(1, 'a later turn')]),
      updatedAt: '2026-08-21T02:00:00.000Z',
    });
    const refused = await handoff.transfer('B');
    expect(refused.reason).toContain('older copy');
    expect(handoff.status()).toEqual(refused);
  }, 30_000);

  it('a resend carries what stays behind now, not what stayed behind at the first attempt', async () => {
    const { a } = await sessions({ approver: operator(true) });
    let changes = true;
    let tasks = [{ status: 'running' }];
    const push = vi.fn(
      async (
        _deviceId: string,
        options: Omit<IPushHandoffOptions, 'openChannel' | 'carrierBinding'>,
      ) => {
        if (push.mock.calls.length === 1) {
          return { outcome: { phase: 'transferring' }, source: {} } as never;
        }
        options.onReadOnly();
        return { outcome: { phase: 'committed' }, source: {} } as never;
      },
    );
    const { handoff } = adapter(a, {
      devices: { list: () => [{ deviceId: 'D1', name: 'desktop' }], push },
      uncommittedChanges: async () => changes,
      getSession: () => ({
        getSessionId: () => 'session-1',
        getCwd: () => scratch,
        isExecuting: () => false,
        listBackgroundTasks: () => tasks,
      }),
    });
    expect((await handoff.transfer('D1')).stillMine).toBe(true);
    changes = false;
    tasks = [];
    expect(await handoff.transfer('D1')).toEqual({ state: 'done', stillMine: false });
    const [first, second] = push.mock.calls.map(([, options]) => options.request);
    // The same transfer, so a receiver that saved it recognises it...
    expect(second?.handoffId).toBe(first?.handoffId);
    expect(second?.record).toBe(first?.record);
    // ...with the inventory as it is at the resend.
    expect(first?.runtime).toMatchObject({ uncommittedChanges: true, subprocesses: 1 });
    expect(second?.runtime).toMatchObject({ uncommittedChanges: false, subprocesses: 0 });
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
      (id) => `test-agent --resume ${id}`,
    );
    expect(said).toContain('was not started');
    expect(said).toContain('test-agent --resume session-1');
  });
});
