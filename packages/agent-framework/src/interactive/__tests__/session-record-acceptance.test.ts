/**
 * When a running session's accepted record becomes the owner's, and what a store view cannot switch
 * off.
 *
 * A person who says a record nobody vouched for is theirs names its exact bytes (`acceptedDigest`).
 * The session raises those bytes to the owner's once, and only after it has restored from them: a
 * resume refused after the acceptance, or a copy (`--fork-session`) made from them, leaves the record
 * exactly as it was. A record handed to a subagent that still saves it is never raised under it. And
 * whatever a store view leaves out, an unverified record is never resumed unaccepted.
 */

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSessionAuthorshipRefusedError } from '../session-authorship-gate.js';
import { SessionPool } from '../../runtime/session-pool.js';
import {
  authorshipOf,
  claimable,
  cleanUpSealedSessionFixtures,
  construct,
  contentOf,
  digestOfFile,
  directory,
  fileBytes,
  forgeRecord,
  readFresh,
  record,
  savedByAnotherProcess,
  sealedStore,
  sessionOptions,
  started,
  turn,
} from './helpers/sealed-session-fixtures.js';

import type { IInteractiveSession, IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

const FORGED_TEXT = 'CANARY-3e-accept-unverified-6b1d';

afterEach(cleanUpSealedSessionFixtures);

describe('an accepted record', () => {
  it('does not claim a served acceptance from a store that cannot discard held plaintext', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_legacy_view', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const claim = vi.fn((...args: Parameters<NodeSessionStore['claim']>) => store.claim(...args));
    const legacy: IInteractiveSessionStore = {
      load: (...args) => store.load(...args), save: (...args) => store.save(...args),
      list: () => store.list(), delete: (id) => store.delete(id), claim,
      lend: (...args) => store.lend(...args), hasWriter: (id) => store.hasWriter(id), authorship: store.authorship,
    };
    const { session, error } = construct(sessionOptions(cwd, legacy, {
      resumeSessionId: 'sess_legacy_view', acceptedDigest: digestOfFile(dir, 'sess_legacy_view'),
      resumeAdmissionSignal: new AbortController().signal,
    }));
    expect(session).toBeUndefined();
    expect(String(error)).toContain('discard');
    expect(claim).not.toHaveBeenCalled();
  });

  it.each(['replaced', 'deleted'] as const)('refuses a record %s after claim but before binding commit', async (change) => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_late_change', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const controller = new AbortController();
    const { session, error } = construct(sessionOptions(cwd, store, {
      resumeSessionId: 'sess_late_change', acceptedDigest: digestOfFile(dir, 'sess_late_change'),
      resumeAdmissionSignal: controller.signal,
    }));
    if (session === undefined) throw error;
    await session.ready();
    if (change === 'replaced') savedByAnotherProcess(dir, sealer, record('sess_late_change', cwd, 'other verified bytes'));
    else unlinkSync(join(dir, 'sess_late_change.json'));

    expect(() => session.commitAcceptedAdmission()).toThrow();
    controller.abort();
    await session.shutdown();
    expect(claimable(store, 'sess_late_change')).toBe(true);
  });

  it('does not persist or snapshot an initialized acceptance that never reaches its owner', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_unmoved', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const original = fileBytes(dir, 'sess_unmoved');
    const saves = vi.spyOn(store, 'save');
    const snapshot = vi.fn(async () => 'late-snapshot');
    const controller = new AbortController();
    const { session, error } = construct(sessionOptions(cwd, store, {
      resumeSessionId: 'sess_unmoved', acceptedDigest: digestOfFile(dir, 'sess_unmoved'),
      resumeAdmissionSignal: controller.signal,
      sandboxClient: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }), readFile: async () => '', writeFile: async () => {}, snapshot },
    }));
    if (session === undefined) throw error;
    await session.ready();
    const writesBeforeCancel = saves.mock.calls.length;
    const unchangedBeforeCancel = fileBytes(dir, 'sess_unmoved').equals(original);
    controller.abort();
    await session.shutdown();
    expect(writesBeforeCancel).toBe(0);
    expect(unchangedBeforeCancel).toBe(true);
    expect(fileBytes(dir, 'sess_unmoved').equals(original)).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_unmoved'))).toBe('unverified');
    expect(saves).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    sealer.lock();
    const reopened = store.claim('sess_unmoved');
    expect(reopened.outcome.status).toBe('locked');
    reopened.release();
  });

  it('starts normal persistence only when an initialized acceptance is committed', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_committed', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const saves = vi.spyOn(store, 'save');
    const controller = new AbortController();
    const { session, error } = construct(sessionOptions(cwd, store, {
      resumeSessionId: 'sess_committed', acceptedDigest: digestOfFile(dir, 'sess_committed'),
      resumeAdmissionSignal: controller.signal,
    }));
    if (session === undefined) throw error;
    await session.ready();
    expect(saves).not.toHaveBeenCalled();
    session.commitAcceptedAdmission();
    expect(saves).toHaveBeenCalled();
    controller.abort();
    expect(claimable(store, 'sess_committed')).toBe(false);
  });

  it('discards a ready accepted pool lease without snapshots or a retained claim', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_lease', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const digest = digestOfFile(dir, 'sess_lease');
    const snapshot = vi.fn(async () => 'late-snapshot');
    const saves = vi.spyOn(store, 'save');
    const primary = createTestInteractiveSession({ getSession: () => ({ getSessionId: () => 'primary' }) });
    let built: IInteractiveSession | undefined;
    const pool = new SessionPool<IInteractiveSession>({
      primary,
      build: () => primary,
      buildAccepted: (_id, acceptedDigest, resumeAdmissionSignal) => {
        const result = construct(sessionOptions(cwd, store, {
          resumeSessionId: 'sess_lease', acceptedDigest, resumeAdmissionSignal,
          sandboxClient: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }), readFile: async () => '', writeFile: async () => {}, snapshot },
        }));
        if (result.session === undefined) throw result.error;
        built = result.session;
        return result.session;
      },
    });
    const controller = new AbortController();
    const lease = await pool.acquireAccepted('sess_lease', digest, controller.signal);
    expect(saves).not.toHaveBeenCalled();
    lease.cancel();
    expect(controller.signal.aborted).toBe(false);
    await built?.shutdown();
    expect(snapshot).not.toHaveBeenCalled();
    expect(saves).not.toHaveBeenCalled();
    expect(claimable(store, 'sess_lease')).toBe(true);
    await pool.shutdownAll();
  });

  it.each(['context_update', 'session_switched'] as const)(
    'keeps an adopted binding committed if a %s listener throws',
    async (event) => {
      const cwd = directory();
      const dir = directory();
      const sealer = createTestArtifactSealer();
      forgeRecord(dir, sealer, record('sess_listener', cwd, FORGED_TEXT));
      const store = sealedStore(dir, sealer);
      const digest = digestOfFile(dir, 'sess_listener');
      const primary = createTestInteractiveSession({ getSession: () => ({ getSessionId: () => 'primary' }) });
      const pool = new SessionPool<IInteractiveSession>({
        primary,
        build: () => primary,
        buildAccepted: (_id, acceptedDigest, resumeAdmissionSignal) => {
          const result = construct(sessionOptions(cwd, store, { resumeSessionId: 'sess_listener', acceptedDigest, resumeAdmissionSignal }));
          if (result.session === undefined) throw result.error;
          return result.session;
        },
      });
      const owner = pool.bind('drive');
      owner.slot.on(event, () => { throw new Error('listener failed'); });
      const lease = await pool.acquireAccepted('sess_listener', digest, new AbortController().signal);
      expect(() => owner.moveTo(lease)).not.toThrow();
      expect(owner.slot.current).toBe(lease.session);
      expect(authorshipOf(readFresh(dir, sealer, 'sess_listener'))).toBe('verified');
      owner.release();
      await pool.shutdownAll();
    },
  );

  it.each(['before', 'after'] as const)('keeps the binding faulted when adoption throws %s the write', async (when) => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_uncertain', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const digest = digestOfFile(dir, 'sess_uncertain');
    const authorship = store.authorship!;
    const view: IInteractiveSessionStore = {
      supportsClaimDiscard: true,
      load: (...args) => store.load(...args), save: (...args) => store.save(...args),
      list: () => store.list(), delete: (id) => store.delete(id),
      claim: (...args) => store.claim(...args), lend: (...args) => store.lend(...args),
      hasWriter: (id) => store.hasWriter(id),
      authorship: {
        ...authorship,
        adopt: (id, accepted) => {
          if (when === 'after') authorship.adopt(id, accepted);
          throw new Error('write confirmation lost');
        },
      },
    };
    const primary = createTestInteractiveSession({ getSession: () => ({ getSessionId: () => 'primary' }) });
    const pool = new SessionPool<IInteractiveSession>({
      primary, build: () => primary,
      buildAccepted: (_id, acceptedDigest, resumeAdmissionSignal) => {
        const result = construct(sessionOptions(cwd, view, { resumeSessionId: 'sess_uncertain', acceptedDigest, resumeAdmissionSignal }));
        if (result.session === undefined) throw result.error;
        return result.session;
      },
    });
    const owner = pool.bind('drive');
    const notices: Error[] = [];
    owner.slot.on('error', (error) => notices.push(error));
    const lease = await pool.acquireAccepted('sess_uncertain', digest, new AbortController().signal);
    expect(() => owner.moveTo(lease)).not.toThrow();
    expect(owner.slot.current).toBe(lease.session);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_uncertain'))).toBe(when === 'after' ? 'verified' : 'unverified');
    expect(notices[0]?.message).toContain('may have been marked as yours');
    await expect(lease.session.submit('must not run')).rejects.toThrow(/ended|shutting down/);
    expect(pool.listLive().some((entry) => entry.sessionId === 'sess_uncertain')).toBe(false);
    await expect(pool.acquire('sess_uncertain')).rejects.toMatchObject({ code: 'in_progress' });
    owner.release();
    await pool.shutdownAll();
  });

  it('refuses a cancellable acceptance before an uncancellable workspace manifest writes', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_manifest', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const writeFile = vi.fn(async () => undefined);
    const { session, error } = construct(sessionOptions(cwd, store, {
      resumeSessionId: 'sess_manifest', acceptedDigest: digestOfFile(dir, 'sess_manifest'),
      resumeAdmissionSignal: new AbortController().signal,
      workspaceManifest: { entries: { 'a.txt': { type: 'file', content: 'first' }, 'b.txt': { type: 'file', content: 'second' } } },
      sandboxClient: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }), readFile: async () => '', writeFile },
    }));
    expect(session).toBeUndefined();
    expect(String(error)).toContain('sandbox');
    expect(writeFile).not.toHaveBeenCalled();
    expect(claimable(store, 'sess_manifest')).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_manifest'))).toBe('unverified');
  });

  it('refuses a cancellable acceptance before an uncancellable sandbox snapshot restores', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_snapshot', cwd, FORGED_TEXT, { sandboxSnapshotId: 'snapshot' }));
    const store = sealedStore(dir, sealer);
    const restore = vi.fn(async () => undefined);
    const { session, error } = construct(sessionOptions(cwd, store, {
      resumeSessionId: 'sess_snapshot', acceptedDigest: digestOfFile(dir, 'sess_snapshot'),
      resumeAdmissionSignal: new AbortController().signal,
      sandboxClient: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }), readFile: async () => '', writeFile: async () => {}, restore },
    }));
    expect(session).toBeUndefined();
    expect(String(error)).toContain('sandbox');
    expect(restore).not.toHaveBeenCalled();
    expect(claimable(store, 'sess_snapshot')).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_snapshot'))).toBe('unverified');
  });

  it('releases a cancelled accepted restore and starts no session after delayed initialization', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_cancelled', cwd, FORGED_TEXT));
    const acceptedDigest = digestOfFile(dir, 'sess_cancelled');
    const store = sealedStore(dir, sealer);
    const saves = vi.spyOn(store, 'save');
    const controller = new AbortController();
    let releaseRestore!: () => void;
    let restoreStarted!: () => void;
    const restoring = new Promise<void>((resolve) => { restoreStarted = resolve; });
    const restore = new Promise<void>((resolve) => { releaseRestore = resolve; });
    const { session, error } = construct(sessionOptions(cwd, store, {
      resumeSessionId: 'sess_cancelled',
      acceptedDigest,
      resumeAdmissionSignal: controller.signal,
      bare: false,
      memoryStore: { loadStartupMemory: async () => { restoreStarted(); await restore; return undefined; } } as never,
    }));
    if (session === undefined) throw error;
    const ready = session.ready();
    await restoring;
    const adopted = fileBytes(dir, 'sess_cancelled');

    controller.abort();
    const immediatelyClaimable = claimable(store, 'sess_cancelled');
    releaseRestore();
    expect(immediatelyClaimable).toBe(true);
    await expect(ready).rejects.toThrow();
    expect(saves).not.toHaveBeenCalled();
    expect(fileBytes(dir, 'sess_cancelled').equals(adopted)).toBe(true);
  });

  it('refuses to create a new session when the accepted record was deleted', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_deleted', cwd, FORGED_TEXT));
    const acceptedDigest = digestOfFile(dir, 'sess_deleted');
    const store = sealedStore(dir, sealer);
    store.delete('sess_deleted');

    const { session, error } = construct(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_deleted', acceptedDigest }),
    );

    expect(session).toBeUndefined();
    expect(error).toMatchObject({ reason: 'changed-since-accepted' });
    expect(store.load('sess_deleted').status).toBe('missing');
  });

  it('refuses different bytes even if the replacement is already verified', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_swapped', cwd, FORGED_TEXT));
    const acceptedDigest = digestOfFile(dir, 'sess_swapped');
    const store = sealedStore(dir, sealer);
    store.save(record('sess_swapped', cwd, 'different verified record'), {
      handoff: true,
      provenance: 'owner',
    });
    expect(authorshipOf(readFresh(dir, sealer, 'sess_swapped'))).toBe('verified');

    const { session, error } = construct(
      sessionOptions(cwd, store, { resumeSessionId: 'sess_swapped', acceptedDigest }),
    );

    expect(session).toBeUndefined();
    expect(error).toMatchObject({ reason: 'changed-since-accepted' });
  });

  it('copied by --fork-session is left exactly as it was, and the copy is the owner’s', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_source', cwd, FORGED_TEXT));
    const before = fileBytes(dir, 'sess_source');
    const store = sealedStore(dir, sealer);

    const fork = await started(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_source',
        acceptedDigest: digestOfFile(dir, 'sess_source'),
        forkSession: true,
      }),
    );
    await turn(fork, 'a turn of the copy');

    expect(fileBytes(dir, 'sess_source').equals(before)).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_source'))).toBe('unverified');
    const copy = readFresh(dir, sealer, fork.sessionId);
    expect(authorshipOf(copy)).toBe('verified');
    expect(contentOf(copy)).toContain(FORGED_TEXT);
  });

  it('is not raised when the host refuses the restored record after the acceptance', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_refused', cwd, FORGED_TEXT));
    const before = fileBytes(dir, 'sess_refused');
    const store = sealedStore(dir, sealer);

    const { session, error } = construct(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_refused',
        acceptedDigest: digestOfFile(dir, 'sess_refused'),
        // What ACP's load does with a record that would start work on its own.
        checkRestoredRecord: () => {
          throw new Error('the host refused the restored record');
        },
      }),
    );

    expect(session).toBeUndefined();
    expect((error as Error).message).toBe('the host refused the restored record');
    expect(fileBytes(dir, 'sess_refused').equals(before)).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_refused'))).toBe('unverified');
  });

  it('is raised once the session restored from it', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_resumed', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);

    await started(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_resumed',
        acceptedDigest: digestOfFile(dir, 'sess_resumed'),
      }),
    );

    expect(authorshipOf(readFresh(dir, sealer, 'sess_resumed'))).toBe('verified');
  });
});

describe('a fork record a subagent still saves', () => {
  it('is not resumed under an acceptance, and the subagent’s next save still goes through', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const parent = sealedStore(dir, sealer);
    parent.save(record('sess_fork', cwd, 'the fork as written'), {
      handoff: true,
      provenance: 'owner',
    });
    const lease = parent.lend('sess_fork');
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    child.importHeld('sess_fork', parent.exportHeld('sess_fork') as string);
    const claim = child.claim('sess_fork', { lease: lease.nonce });
    child.save(record('sess_fork', cwd, 'the child turn'), { claim });
    const accepted = digestOfFile(dir, 'sess_fork');

    const { session } = construct(
      sessionOptions(cwd, parent, { resumeSessionId: 'sess_fork', acceptedDigest: accepted }),
    );

    expect(session).toBeUndefined();
    expect(() =>
      child.save(record('sess_fork', cwd, 'the next child turn'), { claim }),
    ).not.toThrow();
  });
});

describe('a store view without the members a store that seals offers', () => {
  it('never resumes a record nobody vouched for', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    // A hand-written decorator that forwards only what every store has.
    const view = {
      save: (value: Parameters<NodeSessionStore['save']>[0]) => store.save(value),
      load: (id: string, options?: Parameters<NodeSessionStore['load']>[1]) =>
        store.load(id, options),
      list: () => store.list(),
      delete: (id: string) => store.delete(id),
    } as unknown as IInteractiveSessionStore;

    const { session, error } = construct(
      sessionOptions(cwd, view, { resumeSessionId: 'sess_planted' }),
    );

    expect(session).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(FORGED_TEXT);
  });

  it('refuses an unverified record without an acceptance even when it omits the authorship member', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const view = {
      save: (...args: Parameters<NodeSessionStore['save']>) => store.save(...args),
      load: (...args: Parameters<NodeSessionStore['load']>) => store.load(...args),
      list: () => store.list(),
      delete: (id: string) => store.delete(id),
      claim: (...args: Parameters<NonNullable<NodeSessionStore['claim']>>) => store.claim!(...args),
    } as unknown as IInteractiveSessionStore;

    const { session, error } = construct(
      sessionOptions(cwd, view, { resumeSessionId: 'sess_planted' }),
    );

    expect(session).toBeUndefined();
    expect(isSessionAuthorshipRefusedError(error)).toBe(true);
    expect(error).toMatchObject({ reason: 'unverified' });
  });
});
