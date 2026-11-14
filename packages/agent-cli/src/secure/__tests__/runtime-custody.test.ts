/**
 * A secure runtime's custody on a real control socket: the standing each kind of link has, what an
 * unlock does and what takes the keys away again. Every client is the real carrier's, over the real
 * endpoint, so what is admitted and what is refused is what a program on the socket meets.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InteractiveSession, SessionPool, SessionSlot } from '@robota-sdk/agent-framework';
import { createScriptedProvider, createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { SESSION_RECORD_ENVELOPE_VERSION } from '@robota-sdk/agent-session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import {
  createKeyring,
  createRuntimeIdentity,
  openOwnerHandover,
  startSpawnerExchange,
  unlockWithPassphrase,
  type IKeyring,
  type IOwnerHandover,
  type IRuntimeIdentity,
  type SpawnerKey,
} from '@robota-sdk/agent-keyring';
import {
  openOwnerLink,
  openSpawnerLink,
  type IOwnerRuntimeLinkClient,
  type IRuntimeLinkClient,
} from '@robota-sdk/agent-transport/link';
import type { TServerMessage } from '@robota-sdk/agent-transport';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  startSupervisedControl,
  type ISupervisedControl,
} from '../../session-inventory/supervised-session-control.js';
import { MAX_ATTACHED_SURFACES } from '../../session-inventory/supervised-attach.js';
import { createServeSessionDirectory } from '../../modes/serve-session-directory.js';
import { KeyHolder, type IKeyHolderTimer, type IKeyHolderTimers, type TLockReason } from '@robota-sdk/agent-local-host';
import { RuntimeCustody } from '../runtime-custody.js';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  withSwappedSealingKey,
  type IMemoryKeyringStore,
} from './helpers.js';

import type { ISessionBinder, ISessionDirectory } from '@robota-sdk/agent-interface/session';
import type { IProtocolSession } from '@robota-sdk/agent-transport';
import type { IServeOwnerBinding, IServeOwnerDirectory } from '../../modes/serve-session-directory.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const IDLE_MS = 15 * 60_000;
const testHost = createTestFrameworkHost();

let keyring: IKeyring;
let strangerKeyring: IKeyring;
let owner: IOwnerHandover;

beforeAll(async () => {
  const mine = await createKeyring({ passphrase: FIXTURE_PASSPHRASE });
  mine.unlocked.lock();
  keyring = mine.keyring;
  const theirs = await createKeyring({ passphrase: OTHER_PASSPHRASE });
  theirs.unlocked.lock();
  strangerKeyring = theirs.keyring;
  owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
});
afterAll(() => owner.dispose());

/** Timers the test advances by hand, so the idle lock needs no waiting. */
function manualTimers(): IKeyHolderTimers & { advance(ms: number): void } {
  let now = 1_000_000;
  const timers: Array<{ dueAt: number; callback: () => void; live: boolean }> = [];
  return {
    now: () => now,
    setTimer(callback, delayMs): IKeyHolderTimer {
      const timer = { dueAt: now + delayMs, callback, live: true };
      timers.push(timer);
      return { clear: () => (timer.live = false), unref: () => undefined };
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.live && timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due === undefined) break;
        due.live = false;
        now = due.dueAt;
        due.callback();
      }
      now = target;
    },
  };
}

function runtimeOf(run: () => Promise<string>): Record<string, unknown> {
  return {
    run: vi.fn(run),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    assertInputAllowed: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({ maxTokens: 100, usedTokens: 0, usedPercentage: 0, remainingPercentage: 100 }),
    getSessionId: () => 'session_custody',
    getModelId: () => 'test-model',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

function directoryDouble(): { [K in keyof ISessionDirectory]: ReturnType<typeof vi.fn> } {
  return {
    listSessions: vi.fn(() => ({ currentSessionId: 'session_custody', sessions: [], unreadableSessionIds: [] })),
    switchSession: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
  };
}

interface IStarted {
  readonly root: string;
  readonly socketPath: string;
  readonly custody: RuntimeCustody;
  readonly holder: KeyHolder;
  readonly spawnerKey: SpawnerKey;
  readonly instancePublicKey: Uint8Array;
  readonly session: InteractiveSession;
  readonly runtime: Record<string, unknown>;
  readonly timers: ReturnType<typeof manualTimers>;
  readonly locks: TLockReason[];
  readonly rename: ReturnType<typeof vi.fn>;
  readonly directory: ReturnType<typeof directoryDouble>;
  readonly released: ReturnType<typeof vi.fn>;
  /** The keyring file the holder checks grants against, and what it was when the runtime started. */
  readonly store: IMemoryKeyringStore;
  readonly file: IKeyring | undefined;
}

const scratch: string[] = [];
const controls: ISupervisedControl[] = [];
const sockets: Socket[] = [];
const clients: Array<{ close(): void }> = [];
/** The socket each client was opened on, for a test that must stop one reading. */
const socketOf = new Map<unknown, Socket>();

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const socket of sockets.splice(0)) socket.destroy();
  socketOf.clear();
  for (const control of controls.splice(0)) await control.close();
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface IStartOptions {
  readonly swappedFile?: boolean;
  readonly noKeyringFile?: boolean;
  readonly closeFlushTimeoutMs?: number;
  /** Binds each link through a binder over the directory double, as a serving runtime does. */
  readonly withBinder?: boolean;
  /** The binder's `release` fails, as a host that cannot tell a client it is gone might. */
  readonly releaseThrows?: boolean;
  readonly ownerDirectory?: IServeOwnerDirectory;
  readonly binderFactory?: (primary: InteractiveSession) => ISessionBinder<IProtocolSession> & {
    bindOwner(role: 'drive' | 'observe'): IServeOwnerBinding<IProtocolSession>;
  };
}

async function start(options: IStartOptions = {}): Promise<IStarted> {
  const directoryPath = mkdtempSync(join(tmpdir(), 'rs-custody-'));
  scratch.push(directoryPath);
  const root = join(directoryPath, 'supervised');
  const identity: IRuntimeIdentity = createRuntimeIdentity();
  const exchange = startSpawnerExchange();
  const { spawnerKey, instancePublicKey } = exchange.complete(
    identity.answerSpawnerExchange(exchange.message),
  );
  const timers = manualTimers();
  const file = options.noKeyringFile
    ? undefined
    : options.swappedFile
      ? withSwappedSealingKey(keyring, strangerKeyring)
      : keyring;
  const store = createMemoryKeyringStore(file);
  const holder = new KeyHolder({ store, timers });
  const locks: TLockReason[] = [];
  holder.onLock((reason) => locks.push(reason));
  const runtime = runtimeOf(async () => 'answer');
  const session = new InteractiveSession({ host: testHost, session: runtime as never, cwd: '/tmp' });
  const directory = directoryDouble();
  const released = vi.fn(() => {
    if (options.releaseThrows) throw new Error('The host could not release the binding.');
  });
  const binder: ISessionBinder<IProtocolSession> & { bindOwner?: (role: 'drive' | 'observe') => {
    session: IProtocolSession; directory: ISessionDirectory; release: () => void; ownerDirectory: IServeOwnerDirectory;
  } } = {
    bind: () => ({ session, directory: directory as unknown as ISessionDirectory, release: released }),
    ...(options.ownerDirectory !== undefined ? {
      bindOwner: () => ({ session, directory: directory as unknown as ISessionDirectory, release: released, ownerDirectory: options.ownerDirectory! }),
    } : {}),
  };
  const custody = new RuntimeCustody({
    identity,
    holder,
    attachTarget: options.binderFactory !== undefined
      ? { binder: options.binderFactory(session) }
      : options.withBinder ? { binder } : { session },
    ...(options.closeFlushTimeoutMs === undefined
      ? {}
      : { closeFlushTimeoutMs: options.closeFlushTimeoutMs }),
  });
  const rename = vi.fn();
  controls.push(
    await startSupervisedControl({
      id: ID,
      root,
      onStop: () => undefined,
      observe: { activity: () => 'idle', name: () => 'Morning review' },
      rename,
      admission: custody.admission,
    }),
  );
  const socketPath = join(root, readdirSync(root).find((name) => name.endsWith('.sock'))!);
  return {
    root, socketPath, custody, holder, spawnerKey, instancePublicKey, session, runtime, timers, locks,
    rename, directory, released, store, file,
  };
}

async function connectTo(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  return socket;
}

async function spawnerLink(started: IStarted): Promise<IRuntimeLinkClient> {
  const socket = await connectTo(started.socketPath);
  const client = await openSpawnerLink(socket, started.spawnerKey, started.instancePublicKey);
  clients.push(client);
  socketOf.set(client, socket);
  return client;
}

async function ownerLink(started: IStarted): Promise<IOwnerRuntimeLinkClient> {
  const socket = await connectTo(started.socketPath);
  const client = await openOwnerLink(socket, owner);
  clients.push(client);
  socketOf.set(client, socket);
  return client;
}

/** A started runtime its spawner has certified for the owner. */
async function certified(options: IStartOptions = {}): Promise<IStarted> {
  const started = await start(options);
  const spawner = await spawnerLink(started);
  await spawner.installTrustRoot(owner.certify(spawner.instancePublicKey, spawner.binding));
  await spawner.closed;
  // The client may observe its close before the runtime processes its end of the link.
  await vi.waitFor(() => expect(started.custody.spawnerLinks()).toBe(0));
  return started;
}

/** What a client hears of the session protocol, in order. */
function hear(client: IRuntimeLinkClient): {
  readonly frames: TServerMessage[];
  waitFor<T extends TServerMessage['type']>(type: T): Promise<Extract<TServerMessage, { type: T }>>;
} {
  const frames: TServerMessage[] = [];
  client.session.onMessage((message) => frames.push(message));
  return {
    frames,
    waitFor: async (type) => {
      await vi.waitFor(() => {
        if (!frames.some((message) => message.type === type)) throw new Error(`no ${type} yet`);
      });
      return frames.find((message) => message.type === type) as never;
    },
  };
}

async function attach(client: IRuntimeLinkClient, mode: string): Promise<unknown> {
  return client.control({ command: 'attach', fields: { mode } });
}

const refusedWith = (code: string): unknown =>
  expect.objectContaining({ name: 'OwnerRequestRefusedError', code });

describe.skipIf(process.platform === 'win32')('owner decisions over a real link', () => {
  it('invalidates an existing owner question when another grant replaces the holder keys', async () => {
    const invalidate = vi.fn();
    const started = await certified({ withBinder: true, ownerDirectory: {
      question: () => ({ kind: 'open' }), invalidate, openAccepted: async () => undefined,
    } });
    const first = await ownerLink(started);
    const second = await ownerLink(started);
    await first.unlock();
    await attach(first, 'drive');
    await first.question('sess_test');
    invalidate.mockClear();
    await second.unlock();
    expect(invalidate).toHaveBeenCalled();
  });

  it('asks, accepts and moves the driving binding to the exact sealed record', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rs-owner-record-'));
    scratch.push(cwd);
    const records = join(cwd, 'records');
    mkdirSync(records);
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(records, { sealing: { sealer } });
    const sessionId = 'sess_owner_decision';
    const delayedId = 'sess_owner_delayed';
    const closeId = 'sess_owner_close';
    const swappedId = 'sess_owner_swapped';
    const deletedId = 'sess_owner_deleted';
    const regrantId = 'sess_owner_regrant';
    let releaseRestore!: () => void;
    let announceRestore!: () => void;
    const restoring = new Promise<void>((resolve) => { announceRestore = resolve; });
    const restore = new Promise<void>((resolve) => { releaseRestore = resolve; });
    let releaseCloseRestore!: () => void;
    let announceCloseRestore!: () => void;
    const closeRestoring = new Promise<void>((resolve) => { announceCloseRestore = resolve; });
    const closeRestore = new Promise<void>((resolve) => { releaseCloseRestore = resolve; });
    const record = {
      id: sessionId, cwd,
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:01:00.000Z',
      messages: [{ id: 'm1', role: 'user', content: 'untrusted record text', state: 'complete', timestamp: '2026-11-01T00:00:00.000Z' }],
      history: [],
    };
    const grant = openTestWriteGrant(sealer.writeGrant());
    writeFileSync(join(records, `${sessionId}.json`), grant.sealBytes(
      Buffer.from(JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record })),
      { kind: 'session-record', id: sessionId },
    ));
    writeFileSync(join(records, `${delayedId}.json`), grant.sealBytes(
      Buffer.from(JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION,
        record: { ...record, id: delayedId } })),
      { kind: 'session-record', id: delayedId },
    ));
    writeFileSync(join(records, `${closeId}.json`), grant.sealBytes(
      Buffer.from(JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION,
        record: { ...record, id: closeId } })),
      { kind: 'session-record', id: closeId },
    ));
    for (const id of [swappedId, deletedId, regrantId]) {
      writeFileSync(join(records, `${id}.json`), grant.sealBytes(
        Buffer.from(JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: { ...record, id } })),
        { kind: 'session-record', id },
      ));
    }
    let pool: SessionPool<InteractiveSession> | undefined;
    let delayedSession: InteractiveSession | undefined;
    let closeSession: InteractiveSession | undefined;
    const started = await certified({ binderFactory: (primary) => {
      const build = (id: string | undefined, acceptedDigest?: string, resumeAdmissionSignal?: AbortSignal): InteractiveSession => {
        const built = new InteractiveSession({ host: testHost, cwd, provider: createScriptedProvider([{ text: 'ok' }]).provider,
          bare: id !== delayedId && id !== closeId, defaultTools: [], sessionStore: store, resumeSessionId: id, acceptedDigest, resumeAdmissionSignal,
          ...(id === delayedId || id === closeId ? { memoryStore: {
            loadStartupMemory: async () => {
              if (id === closeId) { announceCloseRestore(); await closeRestore; }
              else { announceRestore(); await restore; }
              return undefined;
            },
          } as never } : {}),
        });
        if (id === delayedId) delayedSession = built;
        if (id === closeId) closeSession = built;
        return built;
      };
      pool = new SessionPool({ primary, build, buildAccepted: (id, digest, signal) => build(id, digest, signal) });
      const directory = createServeSessionDirectory<InteractiveSession, SessionSlot<InteractiveSession>>();
      directory.attach({ pool, primary, store, cwd });
      return directory;
    } });
    const client = await ownerLink(started);
    const heard = hear(client);
    await client.unlock();
    const attached = await attach(client, 'drive') as { driverId: string };
    client.session.send({ type: 'switch-session', sessionId, acceptedDigest: 'a'.repeat(64) } as never);
    expect((await heard.waitFor('protocol_error')).message).toContain('acceptedDigest');
    expect(store.load(sessionId)).toMatchObject({ status: 'valid', authorship: 'unverified' });
    const cancelled = await client.question(sessionId);
    expect(cancelled.kind).toBe('accept');
    if (cancelled.kind !== 'accept') throw new Error('Expected owner question');
    await client.cancelQuestion();
    await expect(client.openAccepted(attached.driverId, sessionId, cancelled.digest, cancelled.questionId)).rejects.toBeDefined();
    expect(store.load(sessionId)).toMatchObject({ status: 'valid', authorship: 'unverified' });
    const question = await client.question(sessionId);
    expect(question.kind).toBe('accept');
    if (question.kind !== 'accept') throw new Error('Expected owner question');
    expect(JSON.stringify(question)).not.toContain('untrusted record text');

    await expect(client.openAccepted(attached.driverId, sessionId, cancelled.digest, cancelled.questionId)).rejects.toBeDefined();
    await client.openAccepted(attached.driverId, sessionId, question.digest, question.questionId);
    expect((await heard.waitFor('session_switched')).event.sessionId).toBe(sessionId);
    expect(store.load(sessionId)).toMatchObject({ status: 'valid', authorship: 'verified' });
    expect(pool?.listLive().some((row) => row.sessionId === sessionId && row.clients === 1)).toBe(true);

    const oldQuestion = await client.question(regrantId);
    if (oldQuestion.kind !== 'accept') throw new Error('Expected regrant owner question');
    const replacementOwner = await ownerLink(started);
    await replacementOwner.unlock();
    await expect(client.openAccepted(attached.driverId, regrantId, oldQuestion.digest, oldQuestion.questionId)).rejects.toBeDefined();
    const newQuestion = await client.question(regrantId);
    if (newQuestion.kind !== 'accept') throw new Error('Expected new owner question');
    expect(newQuestion.digest).toBe(oldQuestion.digest);
    expect(newQuestion.questionId).not.toBe(oldQuestion.questionId);
    await expect(client.openAccepted(attached.driverId, regrantId, oldQuestion.digest, oldQuestion.questionId)).rejects.toBeDefined();
    expect(store.load(regrantId)).toMatchObject({ status: 'valid', authorship: 'unverified' });
    await client.cancelQuestion();
    expect(await replacementOwner.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    replacementOwner.close();

    const swappedQuestion = await client.question(swappedId);
    if (swappedQuestion.kind !== 'accept') throw new Error('Expected swapped owner question');
    const beforeSwap = store.load(swappedId);
    if (beforeSwap.status !== 'valid') throw new Error('Expected swapped record');
    new NodeSessionStore(records, { sealing: { sealer } })
      .save({ ...beforeSwap.record, messages: [] }, { provenance: 'owner', handoff: true });
    await expect(client.openAccepted(attached.driverId, swappedId, swappedQuestion.digest, swappedQuestion.questionId)).rejects.toBeDefined();
    expect(new NodeSessionStore(records, { sealing: { sealer } }).load(swappedId))
      .toMatchObject({ status: 'valid', authorship: 'verified' });
    expect(pool?.listLive().some((row) => row.sessionId === swappedId)).toBe(false);

    const deletedQuestion = await client.question(deletedId);
    if (deletedQuestion.kind !== 'accept') throw new Error('Expected deleted owner question');
    store.delete(deletedId);
    await expect(client.openAccepted(attached.driverId, deletedId, deletedQuestion.digest, deletedQuestion.questionId)).rejects.toBeDefined();
    expect(store.load(deletedId).status).toBe('missing');
    expect(pool?.listLive().some((row) => row.sessionId === deletedId)).toBe(false);

    const delayedQuestion = await client.question(delayedId);
    if (delayedQuestion.kind !== 'accept') throw new Error('Expected delayed owner question');
    const delayedOriginal = readFileSync(join(records, `${delayedId}.json`));
    const opening = client.openAccepted(attached.driverId, delayedId, delayedQuestion.digest, delayedQuestion.questionId).catch(() => undefined);
    await restoring;
    const adopted = readFileSync(join(records, `${delayedId}.json`));
    expect(adopted.equals(delayedOriginal)).toBe(true);
    await client.lock('explicit');
    await opening;
    const claim = store.claim(delayedId);
    claim.release();
    const resumed = await ownerLink(started);
    await resumed.unlock();
    const resumedAttached = await attach(resumed, 'drive') as { driverId: string };
    releaseRestore();
    await expect(delayedSession?.whenInitialized()).rejects.toBeDefined();
    expect(readFileSync(join(records, `${delayedId}.json`)).equals(adopted)).toBe(true);
    expect(new NodeSessionStore(records, { sealing: { sealer } }).load(delayedId))
      .toMatchObject({ status: 'valid', authorship: 'unverified' });
    expect(pool?.listLive().some((row) => row.sessionId === delayedId)).toBe(false);
    expect(heard.frames.some((frame) => frame.type === 'session_switched' && frame.event.sessionId === delayedId)).toBe(false);

    const other = await ownerLink(started);
    const closeQuestion = await resumed.question(closeId);
    if (closeQuestion.kind !== 'accept') throw new Error('Expected close owner question');
    const closeOriginal = readFileSync(join(records, `${closeId}.json`));
    const closing = resumed.openAccepted(resumedAttached.driverId, closeId, closeQuestion.digest, closeQuestion.questionId).catch(() => undefined);
    await closeRestoring;
    const closeAdopted = readFileSync(join(records, `${closeId}.json`));
    expect(closeAdopted.equals(closeOriginal)).toBe(true);
    resumed.close();
    await closing;
    await vi.waitFor(() => {
      const released = store.claim(closeId);
      released.release();
    });
    await vi.waitFor(() => expect(started.holder.isUnlocked).toBe(false));
    releaseCloseRestore();
    await expect(closeSession?.whenInitialized()).rejects.toBeDefined();
    expect(readFileSync(join(records, `${closeId}.json`)).equals(closeAdopted)).toBe(true);
    expect(new NodeSessionStore(records, { sealing: { sealer } }).load(closeId))
      .toMatchObject({ status: 'valid', authorship: 'unverified' });
    expect(pool?.listLive().some((row) => row.sessionId === closeId)).toBe(false);
    expect(heard.frames.some((frame) => frame.type === 'session_switched' && frame.event.sessionId === closeId)).toBe(false);
    other.close();
    await pool?.shutdownAll();
  });

  it('binds the decision to the driving link and cancels it when the holder locks', async () => {
    const digest = 'a'.repeat(64);
    const question = vi.fn(() => ({ kind: 'accept' as const, digest, questionId: 'q1', notice: 'notice', question: 'question' }));
    const invalidate = vi.fn();
    const openAccepted = vi.fn((_id: string, _digest: string, _questionId: string, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    const started = await certified({ withBinder: true, ownerDirectory: { question, invalidate, openAccepted } });
    const first = await ownerLink(started);
    const second = await ownerLink(started);
    await first.unlock();
    const firstAttach = await attach(first, 'drive') as { driverId: string };
    const secondAttach = await attach(second, 'drive') as { driverId: string };
    expect(await first.question('sess_test')).toMatchObject({ kind: 'accept', digest });
    await expect(first.openAccepted(secondAttach.driverId, 'sess_test', digest, 'q1')).rejects.toBeDefined();
    expect(openAccepted).not.toHaveBeenCalled();
    const opening = first.openAccepted(firstAttach.driverId, 'sess_test', digest, 'q1').catch(() => undefined);
    await vi.waitFor(() => expect(openAccepted).toHaveBeenCalledTimes(1));
    const signal = openAccepted.mock.calls[0]![3];
    await first.lock('explicit');
    await opening;
    expect(signal.aborted).toBe(true);
    expect(invalidate).toHaveBeenCalled();
    const fresh = await ownerLink(started);
    await fresh.unlock();
    expect(signal.aborted).toBe(true);
  });

  it('does not give an observer the owner decision port', async () => {
    const question = vi.fn(() => ({ kind: 'open' as const }));
    const started = await certified({ withBinder: true, ownerDirectory: { question, invalidate: () => undefined, openAccepted: async () => undefined } });
    const client = await ownerLink(started);
    await client.unlock();
    await attach(client, 'observe');
    await expect(client.question('sess_test')).rejects.toBeDefined();
    expect(question).not.toHaveBeenCalled();
  });

  it('cancels the first link decision on close even while another owner keeps the holder unlocked', async () => {
    const digest = 'a'.repeat(64);
    const openAccepted = vi.fn((_id: string, _digest: string, _questionId: string, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    const started = await certified({ withBinder: true, ownerDirectory: {
      question: () => ({ kind: 'accept', digest, questionId: 'q1', notice: 'notice', question: 'question' }),
      invalidate: () => undefined,
      openAccepted,
    } });
    const first = await ownerLink(started);
    const second = await ownerLink(started);
    await first.unlock();
    const attached = await attach(first, 'drive') as { driverId: string };
    await attach(second, 'observe');
    await first.question('sess_test');
    const opening = first.openAccepted(attached.driverId, 'sess_test', digest, 'q1').catch(() => undefined);
    await vi.waitFor(() => expect(openAccepted).toHaveBeenCalledTimes(1));
    const signal = openAccepted.mock.calls[0]![3];
    expect(await first.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    first.close();
    await opening;
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(started.holder.isUnlocked).toBe(true);
    expect(second.custody.unlocked).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('a runtime before anyone certified it', () => {
  it('admits its spawner, which certifies it once; the spawner link then ends and the spawner is no longer admitted', async () => {
    const started = await start();
    const spawner = await spawnerLink(started);
    expect(spawner.custody).toEqual({ unlocked: false, certified: false });
    const told: boolean[] = [];
    spawner.onCustody((state) => told.push(state.certified));

    await spawner.installTrustRoot(owner.certify(spawner.instancePublicKey, spawner.binding));

    expect(started.custody.status().certified).toBe(true);
    await spawner.closed;
    // The change was told before the link ended, not only seen by whoever asks next.
    expect(told).toEqual([true]);
    await expect(
      openSpawnerLink(await connectTo(started.socketPath), started.spawnerKey, started.instancePublicKey),
    ).rejects.toBeDefined();
  });

  it('revokes a bound spawner before processing a session frame batched with certification', async () => {
    const started = await start();
    const spawner = await spawnerLink(started);
    expect(await attach(spawner, 'drive')).toMatchObject({ status: 'attached' });
    const socket = socketOf.get(spawner);
    if (socket === undefined) throw new Error('Spawner socket missing');
    const queued: Buffer[] = [];
    const intercept = vi.spyOn(socket, 'write').mockImplementation((chunk) => {
      if (!(chunk instanceof Uint8Array)) throw new Error('Expected a binary frame');
      queued.push(Buffer.from(chunk));
      return true;
    });
    const root = owner.certify(spawner.instancePublicKey, spawner.binding);
    const installing = spawner.installTrustRoot(root);
    spawner.session.send({ type: 'submit', prompt: 'must not run after certification' });
    intercept.mockRestore();
    expect(queued).toHaveLength(2);
    socket.write(Buffer.concat(queued));

    await expect(installing).resolves.toBeUndefined();
    await spawner.closed;
    expect(started.runtime.run).not.toHaveBeenCalled();
  });

  it('does not bind a new spawner session after certification in the same batch', async () => {
    const started = await start({ withBinder: true });
    const spawner = await spawnerLink(started);
    const socket = socketOf.get(spawner);
    if (socket === undefined) throw new Error('Spawner socket missing');
    const queued: Buffer[] = [];
    const intercept = vi.spyOn(socket, 'write').mockImplementation((chunk) => {
      if (!(chunk instanceof Uint8Array)) throw new Error('Expected a binary frame');
      queued.push(Buffer.from(chunk));
      return true;
    });
    const root = owner.certify(spawner.instancePublicKey, spawner.binding);
    const installing = spawner.installTrustRoot(root);
    const attaching = attach(spawner, 'drive').catch(() => undefined);
    spawner.session.send({ type: 'submit', prompt: 'must not bind after certification' });
    intercept.mockRestore();
    expect(queued).toHaveLength(3);
    socket.write(Buffer.concat(queued));

    await expect(installing).resolves.toBeUndefined();
    const result = await attaching;
    expect(result).not.toMatchObject({ status: 'attached' });
    await spawner.closed;
    expect(started.runtime.run).not.toHaveBeenCalled();
  });

  it('lets its spawner drive a session it binds, and nothing else of an owner', async () => {
    const started = await start();
    const spawner = await spawnerLink(started);
    const heard = hear(spawner);

    expect(await attach(spawner, 'drive')).toEqual({ status: 'attached', driverId: 'attach:1' });
    spawner.session.send({ type: 'submit', prompt: 'hello' });
    await heard.waitFor('complete');

    await expect(spawner.control({ command: 'rename', fields: { name: 'Mine' } })).rejects.toEqual(
      refusedWith('not-allowed'),
    );
    await expect(spawner.control({ command: 'status', fields: {} })).rejects.toEqual(refusedWith('not-allowed'));
    await expect(spawner.question('anything')).rejects.toEqual(refusedWith('not-allowed'));
    await expect(spawner.openAccepted('attach:1', 'anything', 'a'.repeat(64), 'q1')).rejects.toEqual(refusedWith('not-allowed'));
    await expect(spawner.lock('explicit')).rejects.toEqual(refusedWith('not-allowed'));
    expect(started.rename).not.toHaveBeenCalled();
  });

  it('lets its spawner answer the prompts of what it started', async () => {
    const started = await start();
    const spawner = await spawnerLink(started);
    const heard = hear(spawner);
    await attach(spawner, 'drive');
    const registry = (
      started.session as unknown as {
        promptRegistry: {
          requestPermission(name: string, args: never): Promise<boolean>;
          requestAsk(request: { id: string; title: string }): Promise<unknown>;
        };
      }
    ).promptRegistry;

    const permission = registry.requestPermission('Bash', {} as never);
    const permissionRequest = await heard.waitFor('permission_request');
    spawner.session.send({ type: 'permission-response', id: permissionRequest.event.id, result: true });
    await expect(permission).resolves.toBe(true);

    const ask = registry.requestAsk({ id: 'q1', title: 'Which framework?' });
    const askRequest = await heard.waitFor('ask_request');
    spawner.session.send({
      type: 'ask-response',
      id: askRequest.event.id,
      response: { type: 'answer', values: ['React'] },
    });
    await expect(ask).resolves.toEqual({ type: 'answer', values: ['React'] });
  });

  it('lets its spawner start a session and nothing of the stored ones', async () => {
    const started = await start({ withBinder: true });
    const spawner = await spawnerLink(started);
    const heard = hear(spawner);
    await attach(spawner, 'drive');

    spawner.session.send({ type: 'new-session', requestId: 'n1' });
    await vi.waitFor(() => expect(started.directory.newSession).toHaveBeenCalledTimes(1));
    spawner.session.send({ type: 'switch-session', sessionId: 'session_old', requestId: 's1' });
    spawner.session.send({ type: 'list-sessions', requestId: 'l1' });
    spawner.session.send({ type: 'rename-session', sessionId: 'session_old', name: 'x', requestId: 'r1' });
    spawner.session.send({ type: 'delete-session', sessionId: 'session_old', requestId: 'd1' });

    await heard.waitFor('session_change_failed');
    await heard.waitFor('sessions_error');
    await heard.waitFor('session_rename_failed');
    await heard.waitFor('session_delete_failed');
    expect(started.directory.switchSession).not.toHaveBeenCalled();
    expect(started.directory.listSessions).not.toHaveBeenCalled();
    expect(started.directory.renameSession).not.toHaveBeenCalled();
    expect(started.directory.deleteSession).not.toHaveBeenCalled();
  });

  it('accepts one trust root, however many spawner links ask, and refuses a root for another runtime or owner', async () => {
    const started = await start();
    const first = await spawnerLink(started);
    const second = await spawnerLink(started);
    const other = { ...first.binding, generation: 'A'.repeat(22) };

    await expect(first.installTrustRoot(owner.certify(first.instancePublicKey, other))).rejects.toEqual(
      refusedWith('certificate-mismatch'),
    );
    expect(started.custody.status().certified).toBe(false);

    const root = owner.certify(first.instancePublicKey, first.binding);
    const outcomes = await Promise.allSettled([first.installTrustRoot(root), second.installTrustRoot(root)]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(started.custody.status().certified).toBe(true);
    await Promise.all([first.closed, second.closed]);
  });

  it('is not made a daemon by anyone before it is certified', async () => {
    const started = await start();

    expect(started.custody.takeDaemonRole()).toBe(false);
    expect(started.custody.status().daemon).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('a certified runtime and its owner', () => {
  it('admits the owner, who unlocks it with a read grant, and tells every link', async () => {
    const started = await certified();
    const first = await ownerLink(started);
    const second = await ownerLink(started);
    expect(first.custody).toEqual({ unlocked: false, certified: true });
    const told: boolean[] = [];
    second.onCustody((state) => told.push(state.unlocked));

    expect(await first.unlock()).toBe('verified');

    expect(started.holder.isUnlocked).toBe(true);
    expect(started.store.saves).toEqual([]);
    await vi.waitFor(() => expect(told).toEqual([true]));
    expect(second.custody.unlocked).toBe(true);
  });

  it('reports a swapped sealing key in the file, leaves the file as it is and seals to the granted key', async () => {
    const started = await certified({ swappedFile: true });
    const client = await ownerLink(started);
    const granted = (await unlockWithPassphrase(keyring, FIXTURE_PASSPHRASE)).sealing.publicKey;

    expect(await client.unlock()).toBe('mismatch');

    expect(started.holder.isUnlocked).toBe(true);
    expect(started.store.saves).toEqual([]);
    expect(started.store.current()).toBe(started.file);
    expect(Buffer.from(started.holder.sealingPublicKey())).toEqual(Buffer.from(granted));
  });

  it('refuses a grant when it has no keyring file to check it against, and holds no keys', async () => {
    const started = await certified({ noKeyringFile: true });
    const client = await ownerLink(started);

    await expect(client.unlock()).rejects.toEqual(refusedWith('no-keyring'));

    expect(started.holder.isUnlocked).toBe(false);
  });

  it('runs the owner commands through the plain socket handler, with the whole status', async () => {
    const started = await certified();
    const client = await ownerLink(started);

    expect(await client.control({ command: 'status', fields: {} })).toMatchObject({
      status: 'running',
      name: 'Morning review',
      certified: true,
    });
    expect(await client.control({ command: 'rename', fields: { name: 'Evening review' } })).toEqual({
      status: 'renamed',
    });
    expect(started.rename).toHaveBeenCalledExactlyOnceWith('Evening review');
    for (const command of ['stop', 'lock', 'connect', 'link', 'nope']) {
      expect(await client.control({ command, fields: {} })).toEqual({ status: 'refused' });
    }
  });

  it('is made its workspace daemon by its owner, and says so in the open status', async () => {
    const started = await certified();
    const client = await ownerLink(started);

    expect(await client.control({ command: 'take-daemon-role', fields: {} })).toEqual({ status: 'daemon' });

    expect(started.custody.status().daemon).toBe(true);
  });

  it('refuses owner decisions when no driving directory is attached', async () => {
    const started = await certified();
    const client = await ownerLink(started);

    await expect(client.question('session_x')).rejects.toBeDefined();
    await expect(client.openAccepted('attach:1', 'session_x', 'a'.repeat(64), 'q1')).rejects.toBeDefined();
  });

  it('lets the owner switch to a stored record through its own binding, which a spawner could not', async () => {
    const started = await certified({ withBinder: true });
    const client = await ownerLink(started);
    await client.unlock();
    const heard = hear(client);
    await attach(client, 'drive');

    client.session.send({ type: 'switch-session', sessionId: 'session_old', requestId: 's1' });
    client.session.send({ type: 'list-sessions', requestId: 'l1' });

    await heard.waitFor('sessions');
    expect(started.directory.switchSession).toHaveBeenCalledExactlyOnceWith('session_old');
  });

  it('gives its binding back when the link ends', async () => {
    const started = await certified({ withBinder: true });
    const client = await ownerLink(started);
    await attach(client, 'drive');

    client.close();
    await client.closed;

    await vi.waitFor(() => expect(started.released).toHaveBeenCalledTimes(1));
  });
});

describe.skipIf(process.platform === 'win32')('what the custody reports of its links', () => {
  it('counts spawner links as they open and close, and tells when the runtime is certified', async () => {
    const started = await start();
    const events: string[] = [];
    const stopWatching = started.custody.onChange((event) =>
      events.push(`${event}:${started.custody.spawnerLinks()}`),
    );

    expect(started.custody.hasSeenSpawner()).toBe(false);
    const first = await spawnerLink(started);
    const second = await spawnerLink(started);
    expect(started.custody.hasSeenSpawner()).toBe(true);
    expect(started.custody.spawnerLinks()).toBe(2);
    second.close();
    await second.closed;
    await vi.waitFor(() => expect(started.custody.spawnerLinks()).toBe(1));
    await first.installTrustRoot(owner.certify(first.instancePublicKey, first.binding));
    await first.closed;
    await vi.waitFor(() => expect(started.custody.spawnerLinks()).toBe(0));

    expect(events).toEqual([
      'spawner-linked:1',
      'spawner-linked:2',
      'spawner-dropped:1',
      'certified:1',
      'spawner-dropped:0',
    ]);
    stopWatching();
  });

  it('does not count owner links as spawner links', async () => {
    const started = await certified();
    const events: string[] = [];
    started.custody.onChange((event) => events.push(event));

    const client = await ownerLink(started);
    await client.unlock();
    expect(started.holder.isUnlocked).toBe(true);
    client.close();
    await client.closed;
    // The last-link lock establishes that the runtime processed the owner close.
    await vi.waitFor(() => expect(started.holder.isUnlocked).toBe(false));

    expect(started.custody.spawnerLinks()).toBe(0);
    expect(events).toEqual([]);
  });

  it('stops telling a listener that stopped listening', async () => {
    const started = await start();
    const events: string[] = [];
    const stopWatching = started.custody.onChange((event) => events.push(event));
    stopWatching();

    await spawnerLink(started);

    expect(events).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('what locks a runtime', () => {
  it('fences a grant queued on another owner link before acknowledging a global lock', async () => {
    const started = await certified();
    const locking = await ownerLink(started);
    const stale = await ownerLink(started);
    await locking.unlock();

    await locking.lock('explicit');
    await expect(stale.unlock()).rejects.toBeDefined();
    expect(started.holder.isUnlocked).toBe(false);

    const fresh = await ownerLink(started);
    await fresh.unlock();
    expect(started.holder.isUnlocked).toBe(true);
    fresh.close();
  });

  it('blocks session input and output after lock, then resumes on a new owner link', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    expect(await attach(client, 'drive')).toMatchObject({ status: 'attached' });
    const heard = hear(client);

    await client.lock('explicit');
    await vi.waitFor(() => expect(client.custody.unlocked).toBe(false));
    const framesBefore = heard.frames.length;
    client.session.send({ type: 'submit', prompt: 'must stay locked' });
    await client.closed;
    const proof = await ownerLink(started);
    await proof.control({ command: 'status', fields: {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(started.runtime.run).not.toHaveBeenCalled();
    expect(heard.frames).toHaveLength(framesBefore);

    const fresh = await ownerLink(started);
    await fresh.unlock();
    await attach(fresh, 'drive');
    const freshHeard = hear(fresh);
    fresh.session.send({ type: 'submit', prompt: 'owner returned' });
    await freshHeard.waitFor('complete');
    expect(started.runtime.run).toHaveBeenCalledTimes(1);
  });

  it.each(['explicit', 'screen-lock', 'suspend'] as const)(
    'locks on an owner request for %s, and retires the old link',
    async (reason) => {
      const started = await certified();
      const client = await ownerLink(started);
      await client.unlock();

      await client.lock(reason);

      expect(started.holder.isUnlocked).toBe(false);
      expect(started.locks).toEqual([reason]);
      await vi.waitFor(() => expect(client.custody.unlocked).toBe(false));
      await client.closed;
      const fresh = await ownerLink(started);
      expect(await fresh.control({ command: 'status', fields: {} })).toMatchObject({ status: 'running' });
    },
  );

  it('locks when the last attached client leaves even while a proof-only link remains', async () => {
    const started = await certified({ withBinder: true });
    const first = await ownerLink(started);
    const second = await ownerLink(started);
    const proofOnly = await ownerLink(started);
    await first.unlock();
    expect(await attach(first, 'drive')).toMatchObject({ status: 'attached' });
    expect(await attach(second, 'observe')).toMatchObject({ status: 'attached' });

    expect(await first.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    first.close();
    await first.closed;
    await vi.waitFor(() => expect(started.released).toHaveBeenCalledTimes(1));
    expect(started.holder.isUnlocked).toBe(true);
    expect(started.locks).toEqual([]);

    expect(await second.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    second.close();
    await second.closed;
    await vi.waitFor(() => expect(started.released).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(started.holder.isUnlocked).toBe(false));
    expect(started.locks).toEqual(['last-client-detached']);
    await vi.waitFor(() => expect(proofOnly.custody.unlocked).toBe(false));
  });

  it('globally locks another attached owner when an owner disappears without detach acknowledgement', async () => {
    const started = await certified();
    const first = await ownerLink(started);
    const second = await ownerLink(started);
    await first.unlock();
    expect(await attach(first, 'drive')).toMatchObject({ status: 'attached' });
    expect(await attach(second, 'observe')).toMatchObject({ status: 'attached' });
    first.close();
    await first.closed;
    await vi.waitFor(() => expect(started.locks).toEqual(['fault']));
    expect(started.holder.isUnlocked).toBe(false);
    await second.closed;
  });

  it('keeps a fresh owner unlocked after the old epoch retires', async () => {
    const started = await certified();
    const old = await ownerLink(started);
    await old.unlock();
    await attach(old, 'drive');
    await old.lock('explicit');
    const fresh = await ownerLink(started);
    await fresh.unlock();
    await attach(fresh, 'drive');
    await old.closed;
    expect(started.holder.isUnlocked).toBe(true);
    expect(started.locks).toEqual(['explicit']);
  });

  it('locks a grant-only control link when it closes while a proof-only link remains', async () => {
    const started = await certified();
    const control = await ownerLink(started);
    const proofOnly = await ownerLink(started);
    await control.unlock();

    expect(await control.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    control.close();
    await control.closed;
    await vi.waitFor(() => expect(started.holder.isUnlocked).toBe(false));
    expect(started.locks).toEqual(['last-client-detached']);
    await vi.waitFor(() => expect(proofOnly.custody.unlocked).toBe(false));
  });

  it('locks on the open lock command, which needs no proof, and tells the links', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();

    const socket = await connectTo(started.socketPath);
    socket.setEncoding('utf8');
    const generation = (
      JSON.parse(readFileSync(join(started.root, ID, 'state.json'), 'utf8')) as { generation: string }
    ).generation;
    socket.write(`${JSON.stringify({ command: 'lock', id: ID, generation })}\n`);
    await new Promise<void>((resolve) => socket.once('data', () => resolve()));

    expect(started.locks).toEqual(['explicit']);
    await vi.waitFor(() => expect(client.custody.unlocked).toBe(false));
  });

  it('locks after fifteen idle minutes counted from the owner at the keyboard, not from paging or status polls', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    expect(await attach(client, 'drive')).toMatchObject({ status: 'attached' });
    const heard = hear(client);

    started.timers.advance(IDLE_MS - 60_000);
    client.session.send({ type: 'get-executing' });
    client.session.send({ type: 'get-messages' });
    await client.control({ command: 'status', fields: {} });
    await heard.waitFor('executing');
    started.timers.advance(60_000);

    expect(started.locks).toEqual(['idle']);
    await vi.waitFor(() => expect(client.custody.unlocked).toBe(false));
    await client.closed;
    const fresh = await ownerLink(started);
    expect(await fresh.control({ command: 'status', fields: {} })).toMatchObject({ status: 'running' });
  });

  it('ignores desktop renderer frames for idle activity but accepts the main-owned activity signal', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    expect(await client.control({ command: 'desktop-activity-mode', fields: {} })).toMatchObject({ status: 'native' });
    await attach(client, 'drive');
    const heard = hear(client);

    started.timers.advance(IDLE_MS - 60_000);
    client.session.send({ type: 'submit', prompt: 'renderer traffic' });
    await heard.waitFor('complete');
    started.timers.advance(60_000);
    expect(started.holder.isUnlocked).toBe(false);

    const fresh = await ownerLink(started);
    await fresh.unlock();
    expect(await fresh.control({ command: 'desktop-activity-mode', fields: {} })).toMatchObject({ status: 'native' });
    await attach(fresh, 'drive');
    started.timers.advance(IDLE_MS - 60_000);
    expect(await fresh.control({ command: 'desktop-activity', fields: {} })).toMatchObject({ status: 'recorded' });
    started.timers.advance(60_000);
    expect(started.holder.isUnlocked).toBe(true);
  });

  it.each([
    [
      'a prompt',
      async (client: IOwnerRuntimeLinkClient, heard: ReturnType<typeof hear>) => {
        client.session.send({ type: 'submit', prompt: 'still here' });
        await heard.waitFor('complete');
      },
    ],
    [
      'a change to the runtime',
      async (client: IOwnerRuntimeLinkClient) => {
        await client.control({ command: 'rename', fields: { name: 'Still here' } });
      },
    ],
  ])('keeps the keys while the owner acts with %s', async (_name, act) => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    await attach(client, 'drive');
    const heard = hear(client);

    started.timers.advance(IDLE_MS - 60_000);
    await act(client, heard);
    started.timers.advance(IDLE_MS - 60_000);

    expect(started.holder.isUnlocked).toBe(true);
    expect(started.locks).toEqual([]);
  });

  it('does not count binding, re-binding or a refused bind as the owner at the keyboard', async () => {
    const started = await certified();
    const first = await ownerLink(started);
    await first.unlock();
    expect(await attach(first, 'drive')).toMatchObject({ status: 'attached' });

    started.timers.advance(IDLE_MS - 60_000);
    // A viewer that reconnects, binds again or asks for what it cannot have is not a person typing.
    expect(await attach(first, 'drive')).toEqual({ status: 'refused', reason: 'already-attached' });
    expect(await attach(first, 'both')).toEqual({ status: 'refused', reason: 'unsupported-attach' });
    const second = await ownerLink(started);
    expect(await attach(second, 'observe')).toMatchObject({ status: 'attached' });
    const third = await ownerLink(started);
    expect(await attach(third, 'drive')).toMatchObject({ status: 'attached' });
    started.timers.advance(60_000);

    expect(started.locks).toEqual(['idle']);
  });

  it('does not count the spawner at the keyboard', async () => {
    const started = await start();
    const touch = vi.spyOn(started.holder, 'touch');
    const spawner = await spawnerLink(started);
    const heard = hear(spawner);
    await attach(spawner, 'drive');

    spawner.session.send({ type: 'submit', prompt: 'hello' });
    await heard.waitFor('complete');

    expect(touch).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === 'win32')('the session protocol over a link', () => {
  it('drops frames until the link says what role it binds in, and binds once', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    const heard = hear(client);

    client.session.send({ type: 'submit', prompt: 'too early' });
    expect(await attach(client, 'drive')).toEqual({ status: 'attached', driverId: 'attach:1' });
    expect(await attach(client, 'drive')).toEqual({ status: 'refused', reason: 'already-attached' });
    expect(await attach(client, 'both')).toEqual({ status: 'refused', reason: 'unsupported-attach' });
    client.session.send({ type: 'get-executing' });
    await heard.waitFor('executing');

    expect(started.runtime['run']).not.toHaveBeenCalled();
  });

  it('refuses a mode that is not drive or observe, and binds nothing', async () => {
    const started = await certified();
    const client = await ownerLink(started);

    expect(await attach(client, 'both')).toEqual({ status: 'refused', reason: 'unsupported-attach' });
    expect(await client.control({ command: 'attach', fields: {} })).toEqual({
      status: 'refused',
      reason: 'unsupported-attach',
    });
    expect(await attach(client, 'observe')).toMatchObject({ status: 'attached' });
  });

  it('keeps an observer read-only and out of the prompt path', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    const heard = hear(client);
    expect(await attach(client, 'observe')).toMatchObject({ status: 'attached' });

    client.session.send({ type: 'submit', prompt: 'let me in' });

    expect((await heard.waitFor('protocol_error')).message).toMatch(/observer/);
    expect(started.runtime['run']).not.toHaveBeenCalled();
  });

  it('does not count an observer as the owner at the keyboard', async () => {
    const started = await certified();
    const client = await ownerLink(started);
    await client.unlock();
    await attach(client, 'observe');
    const heard = hear(client);

    started.timers.advance(IDLE_MS - 60_000);
    client.session.send({ type: 'submit', prompt: 'refused, so not an act' });
    await heard.waitFor('protocol_error');
    started.timers.advance(60_000);

    expect(started.locks).toEqual(['idle']);
  });

  it(`refuses a bound surface beyond ${MAX_ATTACHED_SURFACES}, and takes one again when a surface leaves`, async () => {
    const started = await certified();
    const bound: IOwnerRuntimeLinkClient[] = [];
    for (let index = 0; index < MAX_ATTACHED_SURFACES; index += 1) {
      const client = await ownerLink(started);
      expect(await attach(client, 'observe')).toMatchObject({ status: 'attached' });
      bound.push(client);
    }
    const extra = await ownerLink(started);

    expect(await attach(extra, 'observe')).toEqual({ status: 'refused', reason: 'attach-limit' });
    expect(await bound[0]!.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    bound[0]!.close();
    await bound[0]!.closed;
    await vi.waitFor(async () => expect(await attach(extra, 'observe')).toMatchObject({ status: 'attached' }));
  });

  it('locks when the last link closes even if the host cannot release its binding', async () => {
    const started = await certified({ withBinder: true, releaseThrows: true });
    const client = await ownerLink(started);
    await client.unlock();
    await attach(client, 'drive');

    client.close();
    await client.closed;

    await vi.waitFor(() => expect(started.holder.isUnlocked).toBe(false));
    expect(started.locks).toEqual(['fault']);
    expect(started.released).toHaveBeenCalledTimes(1);
  });

  it('takes a surface slot back even if the host cannot release its binding', async () => {
    const started = await certified({ withBinder: true, releaseThrows: true });
    const bound: IOwnerRuntimeLinkClient[] = [];
    for (let index = 0; index < MAX_ATTACHED_SURFACES; index += 1) {
      const client = await ownerLink(started);
      expect(await attach(client, 'observe')).toMatchObject({ status: 'attached' });
      bound.push(client);
    }
    const extra = await ownerLink(started);
    expect(await attach(extra, 'observe')).toEqual({ status: 'refused', reason: 'attach-limit' });

    bound[0]!.close();
    await bound[0]!.closed;

    await vi.waitFor(async () => expect(await attach(extra, 'observe')).toMatchObject({ status: 'attached' }));
  });

  it('cuts a reader that stops reading, and only that one', async () => {
    const started = await certified({ closeFlushTimeoutMs: 200 });
    const slow = await ownerLink(started);
    const fast = await ownerLink(started);
    await fast.unlock();
    await attach(slow, 'observe');
    await attach(fast, 'observe');
    const heard = hear(fast);
    const slowSocket = socketOf.get(slow)!;
    slowSocket.pause();
    const emit = (started.session as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit.bind(
      started.session,
    );
    const delta = 'x'.repeat(64 * 1024);
    const deltas = (): number => heard.frames.filter((frame) => frame.type === 'text_delta').length;

    // The fast reader keeps up with every frame; the paused one falls behind by the whole stream.
    for (let index = 0; index < 64; index += 1) {
      emit('text_delta', delta);
      await vi.waitFor(() => expect(deltas()).toBe(index + 1), { timeout: 5_000 });
    }
    slowSocket.resume();

    await slow.closed;
    expect(fast.custody.certified).toBe(true);
    expect(await fast.control({ command: 'status', fields: {} })).toMatchObject({ status: 'running' });
  }, 30_000);
});
