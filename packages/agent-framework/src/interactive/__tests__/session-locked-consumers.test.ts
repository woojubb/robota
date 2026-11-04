/**
 * The framework's session helpers and the paths that read a record before they write one, when the
 * record is sealed and its keys are locked. `locked` is a fifth answer, not a kind of missing or a
 * kind of corrupt: a listing leaves the session out, a name or id lookup must not claim it is
 * absent, and nothing here may replace it with a fresh record.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface-session/testing';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { describe, expect, it, vi } from 'vitest';

import { persistSession } from '../interactive-session-persistence.js';
import {
  SessionRenameUnavailableError,
  persistSessionRename,
} from '../interactive-session-rename.js';
import { restoreSessionRecordIntoSession } from '../interactive-session-restore.js';
import {
  isSessionLocked,
  listResumableSessionSummaries,
  listResumableSessions,
  listUnreadableSessions,
  lockedSessionMessage,
  lockedSessionReason,
  lockedSessionsNotice,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
  scanSessionStore,
} from '../session-persistence.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function record(id: string, name?: string): IInteractiveSessionRecord {
  return {
    id,
    ...(name === undefined ? {} : { name }),
    cwd: '/work',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    messages: [],
  };
}

/**
 * A directory holding one sealed session and one plain one, the keys locked. `store` is a restarted
 * process's instance (it remembers nothing); `writer` is the instance that wrote the sealed session.
 */
function lockedStore() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'framework-locked-')));
  const sealer = createTestArtifactSealer();
  const writer = new NodeSessionStore(dir, { sealing: { sealer } });
  writer.save(record('sess_sealed', 'sealed name'));
  new NodeSessionStore(dir, { sealing: 'plain' }).save(record('sess_plain', 'plain name'));
  sealer.lock();
  return {
    store: new NodeSessionStore(dir, { sealing: { sealer } }),
    writer,
    sealer,
    dir,
    file: join(dir, 'sess_sealed.json'),
  };
}

describe('the locked-session helpers', () => {
  it('counts the sealed sessions a store cannot open, and nothing for no store or one that cannot count', () => {
    expect(scanSessionStore(lockedStore().store).locked).toBe(1);
    expect(scanSessionStore(undefined)).toEqual({ entries: [], locked: 0 });
    expect(
      scanSessionStore(
        withHoldReadClaim({
          load: () => ({ status: 'missing' }) as const,
          list: () => [],
          save: () => undefined,
          delete: () => undefined,
        }),
      ),
    ).toEqual({ entries: [], locked: 0 });
  });

  it('knows a locked session by its id, and no other kind of answer', () => {
    const { store } = lockedStore();
    expect(isSessionLocked(store, 'sess_sealed')).toBe(true);
    expect(isSessionLocked(store, 'sess_plain')).toBe(false);
    expect(isSessionLocked(store, 'sess_never')).toBe(false);
    expect(isSessionLocked(undefined, 'sess_sealed')).toBe(false);
  });

  it('never asks the store about an id that is not a safe session id', () => {
    const load = vi.fn(() => ({ status: 'locked' }) as const);
    const store = withHoldReadClaim({
      load,
      list: () => [],
      save: () => undefined,
      delete: () => undefined,
    });
    expect(isSessionLocked(store, '../../etc/passwd')).toBe(false);
    expect(isSessionLocked(store, '')).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('says the same fixed thing everywhere', () => {
    expect(lockedSessionMessage('sess_a')).toBe(
      'Session sess_a is sealed and locked; unlock to open it.',
    );
    expect(lockedSessionsNotice(1)).toBe(
      '1 saved session is sealed and locked; unlock to open it.',
    );
    expect(lockedSessionsNotice(4)).toBe(
      '4 saved sessions are sealed and locked; unlock to open them.',
    );
    expect(lockedSessionsNotice(0)).toBeUndefined();
  });

  it('names the unlock command where the surface has one, and only for locked keys', () => {
    expect(lockedSessionMessage('sess_a', 'locked', '/unlock')).toBe(
      'Session sess_a is sealed and locked; run `/unlock` to open it.',
    );
    expect(lockedSessionsNotice(1, 0, '/unlock')).toBe(
      '1 saved session is sealed and locked; run `/unlock` to open it.',
    );
    expect(lockedSessionsNotice(4, 2, '/unlock')).toBe(
      '4 saved sessions are sealed and locked; run `/unlock` to open them. ' +
        '2 saved sessions are sealed with keys this process does not have.',
    );
    // No unlock here opens keys this process does not have, so none is named for them.
    expect(lockedSessionMessage('sess_a', 'no-keys', '/unlock')).toBe(
      'Session sess_a is sealed with keys this process does not have.',
    );
    expect(lockedSessionsNotice(0, 1, '/unlock')).toBe(
      '1 saved session is sealed with keys this process does not have.',
    );
  });
});

/** A directory holding one sealed session, read by a store given no keys at all. */
function noKeysStore(): NodeSessionStore {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'framework-no-keys-')));
  new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
    record('sess_sealed', 'sealed name'),
  );
  return new NodeSessionStore(dir, { sealing: 'plain' });
}

describe('a sealed session in a store that holds no keys', () => {
  it('is counted apart from locked ones, and no notice about it says to unlock', () => {
    const store = noKeysStore();
    expect(scanSessionStore(store)).toMatchObject({ locked: 0, noKeys: 1 });
    expect(listResumableSessions(store, '/work')).toMatchObject({ locked: 0, noKeys: 1 });
    expect(lockedSessionsNotice(0, 1)).toBe(
      '1 saved session is sealed with keys this process does not have.',
    );
    expect(lockedSessionsNotice(0, 3)).toBe(
      '3 saved sessions are sealed with keys this process does not have.',
    );
    expect(lockedSessionsNotice(2, 1)).toBe(
      '2 saved sessions are sealed and locked; unlock to open them. 1 saved session is sealed ' +
        'with keys this process does not have.',
    );
  });

  it('is named by why it does not open, and only locked keys are something to unlock', () => {
    expect(lockedSessionReason(noKeysStore(), 'sess_sealed')).toBe('no-keys');
    expect(lockedSessionReason(lockedStore().store, 'sess_sealed')).toBe('locked');
    expect(lockedSessionReason(lockedStore().store, 'sess_plain')).toBeUndefined();
    expect(lockedSessionMessage('sess_a', 'no-keys')).toBe(
      'Session sess_a is sealed with keys this process does not have.',
    );
    expect(lockedSessionMessage('sess_a', 'changed')).toBe(
      'Session sess_a is sealed, and its file changed after this process read it.',
    );
  });

  it('cannot be restored or renamed, and neither refusal says to unlock', () => {
    const store = noKeysStore();
    expect(() =>
      restoreSessionRecordIntoSession(
        store,
        'sess_sealed',
        {} as never,
        store.load('sess_sealed', { hold: true }),
      ),
    ).toThrow(
      'Cannot resume session sess_sealed: it is sealed with keys this process does not have.',
    );
    expect(() => persistSessionRename(store, 'sess_sealed', 'new name')).toThrow(
      'session sess_sealed could not be renamed on disk: the stored record is sealed with keys ' +
        'this process does not have',
    );
  });
});

describe('listings and lookups with a locked session in the store', () => {
  it('leave the locked session out, and still list the readable one', () => {
    const { store } = lockedStore();
    expect(listResumableSessionSummaries(store, '/work').map((summary) => summary.id)).toEqual([
      'sess_plain',
    ]);
    expect(resolveLatestSessionId(store, '/work')).toBe('sess_plain');
    expect(listUnreadableSessions(store)).toEqual([]);
  });

  it('cannot find a locked session by name or id, which is why a caller asks isSessionLocked', () => {
    const { store } = lockedStore();
    expect(resolveSessionIdByIdOrName(store, 'sealed name')).toMatchObject({ status: 'not-found' });
    expect(resolveSessionIdByIdOrName(store, 'sess_sealed')).toMatchObject({ status: 'not-found' });
    expect(isSessionLocked(store, 'sess_sealed')).toBe(true);
    // A plain file read by a store that seals is unverified: reached by its id, never by the name it
    // gives itself.
    expect(resolveSessionIdByIdOrName(store, 'plain name')).toMatchObject({ status: 'not-found' });
    expect(resolveSessionIdByIdOrName(store, 'sess_plain')).toEqual({
      status: 'found',
      id: 'sess_plain',
    });
  });
});

describe('writers that read before they write', () => {
  it('rename refuses a locked session, names the lock, and leaves the file as it was', () => {
    const { store, file } = lockedStore();
    const before = readFileSync(file);

    let thrown: unknown;
    try {
      persistSessionRename(store, 'sess_sealed', 'new name');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SessionRenameUnavailableError);
    expect((thrown as SessionRenameUnavailableError).outcome).toBe('locked');
    expect((thrown as Error).message).toBe(
      'session sess_sealed could not be renamed on disk: the stored record is sealed and locked; unlock to rename it',
    );
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('a fork job cannot restore a locked session, and says it is locked', () => {
    const { store } = lockedStore();
    expect(() =>
      restoreSessionRecordIntoSession(
        store,
        'sess_sealed',
        {} as never,
        store.load('sess_sealed', { hold: true }),
      ),
    ).toThrow('Cannot resume session sess_sealed: it is sealed and locked; unlock to open it.');
  });

  it('the turn-end persist does not replace a locked session, and a strict one says why', () => {
    const { store, file } = lockedStore();
    const before = readFileSync(file);
    const session = {
      getSessionId: () => 'sess_sealed',
      getConversationSnapshot: () => ({ id: 'sess_sealed', cwd: '/work', messages: [] }),
      getHistory: () => [],
      getSystemMessage: () => 'p',
      getToolSchemas: () => [],
    } as never;

    persistSession(store, session, 'a name', '/work', []);
    expect(readFileSync(file).equals(before)).toBe(true);

    expect(() =>
      persistSession(
        store,
        session,
        'a name',
        '/work',
        [],
        // backgroundState … activeBranchState: none of them is the point here; `strict` is.
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).toThrow('Session record cannot be updated: locked');
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});

describe('the process that holds a session keeps persisting it while locked', () => {
  it('writes the turn, and keeps the name and creation time the stored record carried', () => {
    const { writer, sealer, file } = lockedStore();
    const before = readFileSync(file);
    const session = {
      getSessionId: () => 'sess_sealed',
      getConversationSnapshot: () => ({ id: 'sess_sealed', cwd: '/work', messages: [] }),
      getHistory: () => [],
      getSystemMessage: () => 'p',
      getToolSchemas: () => [],
    } as never;

    persistSession(
      writer,
      session,
      undefined,
      '/work',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(readFileSync(file).equals(before)).toBe(false);
    sealer.unlock();
    const loaded = writer.load('sess_sealed');
    if (loaded.status !== 'valid') throw new Error(`expected valid, got ${loaded.status}`);
    expect(loaded.record.name).toBe('sealed name');
    expect(loaded.record.createdAt).toBe('2026-09-01T00:00:00.000Z');
  });
});
