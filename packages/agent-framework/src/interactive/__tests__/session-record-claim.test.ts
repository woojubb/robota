/**
 * Where a running session claims its record in a store that seals, and what the claim's read lets it
 * restore (#3679 step 3e).
 *
 * Sealing needs only the public key, so any program of the same user can seal a record that opens.
 * The claim's own read is therefore the read a session restores from, and it is gated there: the
 * record must verify as the owner's, or be exactly the bytes the owner accepted. A check made earlier
 * is advisory — something could swap the file after it. Every way a session ends lets the claim go;
 * every save it makes while it runs carries the claim.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { createTestArtifactSealer, leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { isSessionClaimedError } from '@robota-sdk/agent-session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRuntimeSession, startRuntimeHost } from '../../runtime/runtime-host.js';
import { SESSION_STILL_CLOSING_MESSAGE } from '../../runtime/session-change-refusal.js';
import { shutdownSessionBounded } from '../../runtime/session-slot.js';
import { isSessionAuthorshipRefusedError } from '../session-authorship-gate.js';
import { decorateSessionStore } from '../session-store-view.js';
import {
  authorshipOf,
  claimable,
  cleanUpSealedSessionFixtures,
  construct,
  contentOf,
  digestOfFile,
  directory,
  forgeRecord,
  readFresh,
  record,
  sealedStore,
  sessionOptions,
  started,
  turn,
  writeOwnerRecord,
} from './helpers/sealed-session-fixtures.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionClaim,
  ISessionClaimOptions,
  ISessionLoadOptions,
  ISessionSaveOptions,
} from '@robota-sdk/agent-interface-session';

const testHost = createTestFrameworkHost();

const OWNER_TEXT = 'CANARY-3e2-owner-conversation-41d8';
const FORGED_TEXT = 'CANARY-3e2-forged-conversation-9c02';

afterEach(cleanUpSealedSessionFixtures);

/** A live process other than this one — the one that started this test worker. */
function anotherLiveProcess() {
  const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
  const startTime = readProcessStartTime(process.ppid);
  return { ...here, pid: process.ppid, ...(startTime === undefined ? {} : { startTime }) };
}

/** Waits until nothing the session started on its own is still running. */
async function settle(session: { isExecuting(): boolean; getPendingCount(): number }) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (!session.isExecuting() && session.getPendingCount() === 0) return;
  }
}

/** What one store was asked, in order, and the claims it handed out. */
interface IStoreCall {
  readonly method: 'claim' | 'save' | 'load';
  readonly id: string;
  readonly fresh?: boolean;
  readonly options?: ISessionSaveOptions;
  readonly loadOptions?: ISessionLoadOptions;
  readonly argumentCount: number;
}

/** `store`, recording every claim, save and load it is asked for, every other member as it is. */
function recording(store: NodeSessionStore): {
  readonly store: IInteractiveSessionStore;
  readonly calls: IStoreCall[];
  readonly claims: ISessionClaim[];
} {
  const calls: IStoreCall[] = [];
  const claims: ISessionClaim[] = [];
  const view = decorateSessionStore(store, {
    save(value: IInteractiveSessionRecord, ...rest: [ISessionSaveOptions?]) {
      calls.push({
        method: 'save',
        id: value.id,
        ...(rest[0] !== undefined ? { options: rest[0] } : {}),
        argumentCount: 1 + rest.length,
      });
      store.save(value, ...rest);
    },
    load(id: string, ...rest: [ISessionLoadOptions?]) {
      calls.push({
        method: 'load',
        id,
        ...(rest[0] !== undefined ? { loadOptions: rest[0] } : {}),
        argumentCount: 1 + rest.length,
      });
      return store.load(id, ...rest);
    },
    claim(id: string, options?: ISessionClaimOptions) {
      calls.push({ method: 'claim', id, fresh: options?.fresh === true, argumentCount: 2 });
      const handle = store.claim(id, options);
      claims.push(handle);
      return handle;
    },
  });
  return { store: view, calls, claims };
}

describe('resuming over a store that seals', () => {
  it('restores from the claim, so a record swapped in after an earlier check is refused', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, record('sess_swap', cwd, OWNER_TEXT));
    const store = sealedStore(dir, sealer);
    // The earlier check, as a launcher makes it before it builds the session: the owner's record.
    expect(authorshipOf(store.load('sess_swap'))).toBe('verified');
    // Then something with only the public key puts its own record there.
    forgeRecord(dir, sealer, record('sess_swap', cwd, FORGED_TEXT));

    const { session, error } = construct(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_swap' }),
    );

    expect(session).toBeUndefined();
    expect(isSessionAuthorshipRefusedError(error)).toBe(true);
    expect(error).toMatchObject({ sessionId: 'sess_swap', reason: 'unverified' });
    expect((error as Error).message).not.toContain(FORGED_TEXT);
    // A refused resume holds nothing: the id is free again.
    expect(claimable(store, 'sess_swap')).toBe(true);
  });

  it('admits exactly the bytes the owner accepted, and then holds them as the owner’s', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_accepted', cwd, FORGED_TEXT));
    const accepted = digestOfFile(dir, 'sess_accepted');
    const store = sealedStore(dir, sealer);

    const unaccepted = construct(sessionOptions(cwd, store, { resumeSessionId: 'sess_accepted' }));
    const otherBytes = construct(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_accepted',
        acceptedDigest: 'f'.repeat(64),
      }),
    );
    expect(unaccepted.error).toMatchObject({ reason: 'unverified' });
    expect(otherBytes.error).toMatchObject({ reason: 'changed-since-accepted' });
    expect((otherBytes.error as Error).message).toBe(
      'Cannot resume session sess_accepted: the session changed on disk after you accepted it; ' +
        'resume it again to review it.',
    );

    const session = await started(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_accepted', acceptedDigest: accepted }),
    );

    expect(JSON.stringify(session.getSession().getHistory())).toContain(FORGED_TEXT);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_accepted'))).toBe('verified');
  });

  it('claims over a store that never seals too, restoring from its plain hold read', async () => {
    const cwd = directory();
    const dir = directory();
    const plain = new NodeSessionStore(dir, { sealing: 'plain' });
    plain.save(record('sess_plain', cwd, OWNER_TEXT));
    const { store, calls, claims } = recording(plain);

    const session = await started(sessionOptions(cwd, store, { resumeSessionId: 'sess_plain' }));
    session.setName('renamed');
    await turn(session, 'one more turn');

    expect(calls.find((call) => call.id === 'sess_plain')).toMatchObject({
      method: 'claim',
      fresh: false,
    });
    expect(calls.some((call) => call.method === 'load' && call.loadOptions === undefined)).toBe(
      false,
    );
    const saves = calls.filter((call) => call.method === 'save' && call.id === 'sess_plain');
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.every((call) => call.options?.claim === claims[0])).toBe(true);
    // A second session in this process does not take the id while this one runs.
    expect(claimable(store, 'sess_plain')).toBe(false);
    const stored = plain.load('sess_plain');
    expect(stored).not.toHaveProperty('authorship');
    expect(stored.status === 'valid' && stored.record.name).toBe('renamed');
  });
});

describe('where a session claims its record', () => {
  it('claims in every construction path: built from a recipe, resumed, injected and pooled', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, record('sess_resumed', cwd, OWNER_TEXT));
    const store = sealedStore(dir, sealer);

    // TUI, print, ACP and the headless channel all build through this one seam.
    const built = buildRuntimeSession(sessionOptions(cwd, store));
    const resumed = buildRuntimeSession(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_resumed' }),
    );
    // The resumed id is claimed at construction, before the session has even started.
    expect(claimable(store, 'sess_resumed')).toBe(false);
    await built.whenInitialized();
    await resumed.whenInitialized();
    expect(claimable(store, built.sessionId)).toBe(false);

    // A headless host that builds its own Session and injects it.
    const inner = (
      await started(sessionOptions(cwd, new NodeSessionStore(directory(), { sealing: 'plain' })))
    ).getSession();
    const injected = construct({
      host: testHost,
      session: inner,
      cwd,
      sessionStore: store,
    }).session!;
    expect(claimable(store, injected.sessionId)).toBe(false);

    // A served runtime's pool builds its sessions from the same recipe.
    const host = await startRuntimeHost({ session: sessionOptions(cwd, store), pool: {} });
    const lease = await host.pool!.acquire();
    expect(claimable(store, lease.session.sessionId)).toBe(false);

    lease.cancel();
    await host.shutdown();
    await built.shutdown();
    await resumed.shutdown();
    await injected.shutdown();
    expect(claimable(store, built.sessionId)).toBe(true);
    expect(claimable(store, 'sess_resumed')).toBe(true);
    expect(claimable(store, lease.session.sessionId)).toBe(true);
  });

  it('claims a new session fresh before its first save, and every save carries the claim', async () => {
    const cwd = directory();
    const sealer = createTestArtifactSealer();
    const { store, calls, claims } = recording(sealedStore(directory(), sealer));

    const session = await started(sessionOptions(cwd, store));
    const id = session.sessionId;

    const own = calls.filter((call) => call.id === id && call.method !== 'load');
    expect(own[0]).toMatchObject({ method: 'claim', fresh: true });
    const saves = own.filter((call) => call.method === 'save');
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.every((call) => call.options?.claim === claims[0])).toBe(true);
    expect(saves.every((call) => call.options?.provenance === 'owner')).toBe(true);
  });

  it('refuses a second session on a live id, and the pool tells its client to try again', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, record('sess_live', cwd, OWNER_TEXT));
    const store = sealedStore(dir, sealer);
    await started(sessionOptions(cwd, store, { resumeSessionId: 'sess_live' }));

    const second = construct(sessionOptions(cwd, store, { resumeSessionId: 'sess_live' }));
    expect(isSessionClaimedError(second.error)).toBe(true);

    const host = await startRuntimeHost({ session: sessionOptions(cwd, store), pool: {} });
    await expect(host.pool!.acquire('sess_live')).rejects.toMatchObject({
      name: 'SessionChangeRefusal',
      code: 'still_closing',
      message: SESSION_STILL_CLOSING_MESSAGE,
    });
    // The pool goes on serving.
    const lease = await host.pool!.acquire();
    expect(lease.session.sessionId).not.toBe('sess_live');
    lease.cancel();
    await host.shutdown();
  });

  it('tells a pool client which other process writes a record, with has_writer', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, record('sess_elsewhere', cwd, OWNER_TEXT));
    leaveProcessMarker(join(dir, 'claims'), 'sess_elsewhere', anotherLiveProcess());
    const store = sealedStore(dir, sealer);

    const host = await startRuntimeHost({ session: sessionOptions(cwd, store), pool: {} });
    const refusal = await host.pool!.acquire('sess_elsewhere').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({ name: 'SessionChangeRefusal', code: 'has_writer' });
    expect((refusal as Error).message).toContain(`pid ${process.ppid}`);
    await host.shutdown();
  });

  it('tells a pool client a subagent this process started holds a record lent from it, with has_writer', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const store = sealedStore(dir, sealer);
    store.save(record('sess_handed', cwd, OWNER_TEXT), { handoff: true, provenance: 'owner' });
    const lease = store.lend('sess_handed');

    // The child has not taken the marker over yet.
    const host = await startRuntimeHost({ session: sessionOptions(cwd, store), pool: {} });
    const refusal = await host.pool!.acquire('sess_handed').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({ name: 'SessionChangeRefusal', code: 'has_writer' });
    expect((refusal as Error).message).toContain('subagent this process started');
    expect((refusal as Error).message).not.toBe(SESSION_STILL_CLOSING_MESSAGE);
    lease.end();
    await host.shutdown();
  });

  it('names the child that took a lent record over, with has_writer, not that the session is closing', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const store = sealedStore(dir, sealer);
    store.save(record('sess_handed', cwd, OWNER_TEXT), { handoff: true, provenance: 'owner' });
    const lease = store.lend('sess_handed');
    // The child process took the marker over, keeping the lease's digest.
    const child = anotherLiveProcess();
    leaveProcessMarker(
      join(dir, 'claims'),
      'sess_handed',
      child,
      createHash('sha256').update(lease.nonce).digest('hex'),
    );

    const host = await startRuntimeHost({ session: sessionOptions(cwd, store), pool: {} });
    const refusal = await host.pool!.acquire('sess_handed').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({ name: 'SessionChangeRefusal', code: 'has_writer' });
    expect((refusal as Error).message).toContain(`pid ${child.pid}`);
    lease.end();
    await host.shutdown();
  });

  it('lets the claim go when a shutdown times out, and fences that session’s late save', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const { store, claims } = recording(sealedStore(dir, sealer));
    let unblock: () => void = () => undefined;
    const wedged = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const first = await started(
      sessionOptions(cwd, store, {
        commandModules: [{ name: 'wedged-on-shutdown', shutdown: () => wedged }],
      }),
    );
    const id = first.sessionId;
    try {
      first.setName('written by the first session');
      // While the first session runs, nobody else takes its id.
      const second = construct(sessionOptions(cwd, store, { resumeSessionId: id }));
      expect(isSessionClaimedError(second.error)).toBe(true);

      await shutdownSessionBounded(first, 'gave up waiting', 20);
      const next = await started(sessionOptions(cwd, store, { resumeSessionId: id }));
      next.setName('written by the next session');
    } finally {
      unblock();
    }
    await first.shutdown().catch(() => undefined);
    const firstClaim = claims[0]!;

    const stored = readFresh(dir, sealer, id);
    expect(stored.status === 'valid' ? stored.record.name : stored.status).toBe(
      'written by the next session',
    );
    let refusal: unknown;
    try {
      store.save(record(id, cwd, 'a late save'), { claim: firstClaim });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'SESSION_CLAIMED', reason: 'released' });
  });

  it('lets the claim go when the session fails to start', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    // A record whose sandbox snapshot nothing here can restore: the build fails after the claim.
    writeOwnerRecord(
      dir,
      sealer,
      record('sess_unstartable', cwd, OWNER_TEXT, { sandboxSnapshotId: 'snapshot-nobody-has' }),
    );
    const store = sealedStore(dir, sealer);

    const { session } = construct(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_unstartable' }),
    );
    expect(claimable(store, 'sess_unstartable')).toBe(false);
    await expect(session!.whenInitialized()).rejects.toThrow(/sandbox/i);

    expect(claimable(store, 'sess_unstartable')).toBe(true);
  });
});

describe('the saves a claimed session makes of its own record', () => {
  it('are never refused under its own claim: turns, rename, loops, goals, plans and history', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const store = sealedStore(dir, sealer);
    const session = await started(
      sessionOptions(cwd, store, {}, [
        { text: 'first reply' },
        { text: 'a loop reply' },
        { text: 'a goal reply' },
        { text: 'a spare reply' },
      ]),
    );
    const id = session.sessionId;
    const errors: Error[] = [];
    session.on('error', (error) => errors.push(error));

    await turn(session, 'a turn');
    // `/rename` is a host action that lands here.
    session.setName('renamed in session');
    // A loop's transitions are strict writes: a refused one would throw here.
    const loop = await session.createSelfPacedLoop('check the build');
    await session.stopSelfPacedLoop(loop.loopId);
    await session.setPlan('an objective', ['a step']);
    session.approvePlan();
    session.setAutoCompactThreshold(0.5);
    await session.setGoal('a goal', { maxIterations: 1 });
    session.cancelGoal();
    await settle(session);

    expect(errors).toEqual([]);
    // Claimed the whole time, and what it wrote is the owner's.
    expect(claimable(store, id)).toBe(false);
    const stored = readFresh(dir, sealer, id);
    expect(authorshipOf(stored)).toBe('verified');
    if (stored.status !== 'valid') throw new Error(`expected valid, got ${stored.status}`);
    expect(stored.record.name).toBe('renamed in session');
    expect(stored.record.plan).toBeDefined();
    expect(stored.record.goal?.status).not.toBe('active');
    expect(stored.record.sessionLoops?.[0]?.phase).toBe('stopped');
  });
});

describe('a copy of a stored session (--fork-session)', () => {
  it('reads its source through the gate, lets the source go, and is the owner’s', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, record('sess_source', cwd, OWNER_TEXT));
    const store = sealedStore(dir, sealer);

    const fork = await started(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_source', forkSession: true }),
    );

    expect(fork.sessionId).not.toBe('sess_source');
    expect(claimable(store, 'sess_source')).toBe(true);
    expect(claimable(store, fork.sessionId)).toBe(false);
    const copy = readFresh(dir, sealer, fork.sessionId);
    expect(authorshipOf(copy)).toBe('verified');
    expect(contentOf(copy)).toContain(OWNER_TEXT);
  });

  it('refuses a source nothing shows the owner wrote', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);

    const { error } = construct(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_planted', forkSession: true }),
    );

    expect(error).toMatchObject({ reason: 'unverified' });
    expect(claimable(store, 'sess_planted')).toBe(true);
  });
});
