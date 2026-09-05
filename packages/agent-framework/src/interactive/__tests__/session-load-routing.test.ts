/**
 * TRANS-007 (issue #2096) — every load path routes through the decoder, and the replay log is
 * reached only by `missing`.
 *
 * The decoder has its own exhaustive suite, and that suite proves the DECODER. It says nothing about
 * whether each sink calls it: a guard is not covered because the module that defines it is covered.
 * The decision "which of the four things happened" has several sinks — the project store's `load`,
 * its `list`, its replay fallback, and the resume path that reads the result — so each is driven
 * here rather than asserted through the one that is easiest to reach.
 *
 * The replay gate is the case with teeth. Before this leaf, any parse failure fell through to the
 * append-only log and produced a partial reconstruction: no `goal`, no `plan`, no `activeBranch`, no
 * `toolSchemas`, and nothing said. A user whose snapshot was damaged silently resumed a lesser
 * session. Recovery is for absence; a damaged record is reported.
 */

import { mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SESSION_RECORD_ENVELOPE_VERSION } from '@robota-sdk/agent-session';
import { describe, expect, it } from 'vitest';

import { getWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import {
  createTrustedProjectAccessFixture,
  createTrustedProjectSessionStoreFixture,
} from '../../testing/trusted-project-state-fixture.js';
import { WorkspaceSessionLogSink } from '../workspace-session-io.js';
import { persistSession } from '../interactive-session-persistence.js';
import { persistSessionRename } from '../interactive-session-rename.js';
import { loadSessionRecord } from '../interactive-session-restore.js';
import { listResumableSessionSummaries, listUnreadableSessions } from '../session-persistence.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const SESSION_ID = 'sess_routing';

function record(id = SESSION_ID, cwd = '/work'): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: 'hello',
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

async function projectFixture(): Promise<{ root: string; sessionsDir: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'trans-007-project-')));
  return { root, sessionsDir: join(root, '.robota', 'sessions') };
}

describe('TC-01: the replay log is reached by missing and by nothing else', () => {
  it('reports missing when there is neither a snapshot nor a log', async () => {
    const { root } = await projectFixture();
    const store = await createTrustedProjectSessionStoreFixture(root);
    expect(store.load('no-such-session')).toEqual({ status: 'missing' });
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'reports corrupt — NOT a replayed reconstruction — when the snapshot is damaged',
    async () => {
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());
      await writeFile(join(sessionsDir, `${SESSION_ID}.json`), '{"schemaVersion":1,"rec', 'utf-8');

      const outcome = store.load(SESSION_ID);
      expect(outcome.status).toBe('corrupt');
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'reports unsupported for a pre-envelope snapshot rather than replaying around it',
    async () => {
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());
      await writeFile(
        join(sessionsDir, `${SESSION_ID}.json`),
        JSON.stringify(record(), null, 2),
        'utf-8',
      );

      expect(store.load(SESSION_ID)).toEqual({ status: 'unsupported', schemaVersion: undefined });
    },
  );
});

// ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
describe.runIf(process.platform === 'linux')(
  'TC-08 / TC-09: unreadable sessions are reported, not dropped',
  () => {
    it('lists an unreadable snapshot and excludes it from the resumable summaries', async () => {
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record('readable'));
      await writeFile(
        join(sessionsDir, 'from-an-older-build.json'),
        JSON.stringify(record('from-an-older-build'), null, 2),
        'utf-8',
      );

      // Present in the store's own listing…
      expect(
        store
          .list()
          .map((entry) => entry.id)
          .sort(),
      ).toEqual(['from-an-older-build', 'readable']);

      // …absent from what can be RESUMED, which is what that projection promises…
      expect(listResumableSessionSummaries(store, '/work').map((s) => s.id)).toEqual(['readable']);

      // …and reachable by a surface that wants to say why.
      const unreadable = listUnreadableSessions(store);
      expect(unreadable.map((entry) => entry.id)).toEqual(['from-an-older-build']);
      expect(unreadable[0]?.outcome.status).toBe('unsupported');
    });

    it('reports a file whose NAME is not a usable session id rather than dropping it', async () => {
      // The project store filtered these out by name, which is the same disappearance this work
      // removes for unreadable CONTENT — a session gone from the picker with nothing said. The node
      // store had the mirror-image bug and threw. Both stores implement one port and must answer
      // alike, or the outcome type describes only whichever one a caller happens to hold.
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record('readable'));
      await writeFile(join(sessionsDir, 'my session.json'), '{}', 'utf-8');

      const entries = store.list();
      expect(entries.map((entry) => entry.id).sort()).toEqual(['my session', 'readable']);
      expect(entries.find((entry) => entry.id === 'my session')?.outcome.status).toBe('corrupt');
      expect(listResumableSessionSummaries(store, '/work').map((s) => s.id)).toEqual(['readable']);
    });
  },
);

describe('TC-06: resume says why a session came back empty', () => {
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'reports the outcome instead of a session indistinguishable from a new one',
    async () => {
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());
      await writeFile(
        join(sessionsDir, `${SESSION_ID}.json`),
        JSON.stringify(record(), null, 2),
        'utf-8',
      );

      const restored = loadSessionRecord(store, SESSION_ID, null);
      expect(restored.history).toEqual([]);
      // The empty shape used to be the whole answer. The outcome is what separates "nothing was
      // saved" from "something is here that this build cannot read".
      expect(restored.loadOutcome.status).toBe('unsupported');
    },
  );

  it('reports missing for a session that genuinely was never saved', async () => {
    const { root } = await projectFixture();
    const store = await createTrustedProjectSessionStoreFixture(root);
    const restored = loadSessionRecord(store, 'never-saved', null);
    expect(restored.loadOutcome.status).toBe('missing');
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')('restores a readable session and says so', async () => {
    const { root } = await projectFixture();
    const store = await createTrustedProjectSessionStoreFixture(root);
    store.save(record());
    const restored = loadSessionRecord(store, SESSION_ID, null);
    expect(restored.loadOutcome.status).toBe('valid');
    expect(restored.pendingRestoreMessages?.[0]?.content).toBe('hello');
  });
});

// ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
describe.runIf(process.platform === 'linux')(
  'TC-10: the project store writes the envelope too',
  () => {
    it('persists { schemaVersion, record } rather than the bare record', async () => {
      const { root } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());

      const outcome = store.load(SESSION_ID);
      expect(outcome.status).toBe('valid');
      // Round-tripping through this store proves the pair agrees; the shape assertion is what proves
      // the format. `SESSION_RECORD_ENVELOPE_VERSION` is the single constant both stores write.
      expect(SESSION_RECORD_ENVELOPE_VERSION).toBe(1);
    });
  },
);

// ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
describe.runIf(process.platform === 'linux')(
  'TC-05: the framework write path refuses mid read-modify-write',
  () => {
    /**
     * The claim is not "a failed load is reported" — it is "a record this build cannot read is not
     * overwritten". That lives on the SECOND path: the caller has already decided to save, reads the
     * stored record to preserve the members it does not own, and it is the value of THAT read which
     * used to be `undefined` for both "no record" and "damaged".
     *
     * So this drives `persistSession` against a damaged snapshot and asserts the bytes, rather than
     * asserting that `load` reported `corrupt` — which the load tests above already prove and which
     * would not catch a write path that ignored the outcome.
     */
    it('leaves a pre-envelope snapshot byte-identical when a save is attempted over it', async () => {
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());

      const file = join(sessionsDir, `${SESSION_ID}.json`);
      await writeFile(file, JSON.stringify(record(), null, 2), 'utf-8');
      const before = await readFile(file, 'utf-8');

      persistSession(
        store,
        {
          getSessionId: () => SESSION_ID,
          getHistory: () => [],
          getSystemMessage: () => 'p',
          getToolSchemas: () => [],
        } as never,
        'a new name',
        '/work',
        [],
      );

      expect(await readFile(file, 'utf-8')).toBe(before);
    });

    // The positive control. Without it, the refusal case above would pass against a `persistSession`
    // that never writes at all — a test that proves a refusal must also prove the write it refuses.
    it('still writes when the stored record is genuinely absent', async () => {
      const { root } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);

      persistSession(
        store,
        {
          getSessionId: () => 'brand-new',
          getHistory: () => [],
          getSystemMessage: () => 'p',
          getToolSchemas: () => [],
        } as never,
        'a new name',
        '/work',
        [],
      );

      expect(store.load('brand-new').status).toBe('valid');
    });
  },
);

// ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
describe.runIf(process.platform === 'linux')(
  'TC-01b: a replayed reconstruction is decoded like everything else',
  () => {
    /**
     * The decode guard was first written at the file-read path, and this store has two OTHER places a
     * `valid` outcome comes into existence, both from the replay log. Enumerating the sink is not the
     * same as covering every path that reaches it.
     *
     * Choosing the assertion took three attempts and the first two were worthless:
     *   1. saving a snapshot and loading it — the snapshot path answered, so the replay path was never
     *      reached and the case passed with the guard reversed;
     *   2. asserting a revived `Date` on a replayed session — the reconstruction already builds
     *      `Date`s, so the property held with or without the guard.
     * Both SURVIVED a mutation that removed the guard, which is the only reason they were found. The
     * property that separates a decoded replay from a cast one is whether an INVALID reconstruction
     * can present itself as a resumable session.
     */
    async function projectWithLog(lines: readonly string[]): Promise<string> {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'trans-007-replay-')));
      const access = await createTrustedProjectAccessFixture(root);
      if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
      new WorkspaceSessionLogSink(
        getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
      ).append('log-only', `${lines.join('\n')}\n`);
      return root;
    }

    const init = (): string =>
      JSON.stringify({
        timestamp: '2026-05-05T00:00:00.000Z',
        sessionId: 'log-only',
        event: 'session_init',
        cwd: '/work',
      });

    const appendMessage = (message: Record<string, unknown>): string =>
      JSON.stringify({
        timestamp: '2026-05-05T00:00:01.000Z',
        sessionId: 'log-only',
        event: 'history_mutation',
        mutation: 'append_message',
        message,
      });

    it('reports a replayed reconstruction that does not decode as corrupt, not valid', async () => {
      // `state` is required by the message contract. A log carrying a message without it reconstructs
      // into something that is not a session record — and before the guard moved to the producer, the
      // store handed that back as a resumable session.
      const root = await projectWithLog([
        init(),
        appendMessage({ id: 'u1', role: 'user', content: 'hello' }),
      ]);
      const store = await createTrustedProjectSessionStoreFixture(root);
      expect(store.load('log-only').status).toBe('corrupt');
    });

    it('still resumes a replayed session that DOES decode', async () => {
      // The positive control. Without it the case above passes against a store that reports every
      // replayed session as corrupt, which would be a worse defect than the one being fixed.
      const root = await projectWithLog([
        init(),
        appendMessage({
          id: 'u1',
          role: 'user',
          content: 'hello',
          state: 'complete',
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
      ]);
      const store = await createTrustedProjectSessionStoreFixture(root);
      const outcome = store.load('log-only');
      expect(outcome.status).toBe('valid');
      if (outcome.status !== 'valid') throw new Error('expected valid');
      expect(outcome.record.messages).toHaveLength(1);
    });
  },
);

describe('TC-07: a rename that cannot be written down says so', () => {
  /**
   * This case exists because the first version of the fix was wrong in a way the plan did not catch.
   * `setName` reported the failure by throwing — from INSIDE a `try { … } catch { /* Session not
   * initialized yet *\/ }`. The report was swallowed by a catch meant for something else, so the
   * rename was still a silent no-op and the change had replaced one silence with another.
   *
   * The assertion is therefore that the failure ESCAPES, not that a branch was taken.
   */
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'throws rather than silently failing when the stored record cannot be read',
    async () => {
      const { root, sessionsDir } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());
      await writeFile(
        join(sessionsDir, `${SESSION_ID}.json`),
        JSON.stringify(record(), null, 2),
        'utf-8',
      );

      expect(() => persistSessionRename(store, SESSION_ID, 'a new name')).toThrow(/unsupported/);
    },
  );

  it('does not throw for a session with nothing saved yet', async () => {
    // The positive control: `missing` is not a failure, and a rename test that threw on everything
    // would pass the case above while breaking every first rename.
    const { root } = await projectFixture();
    const store = await createTrustedProjectSessionStoreFixture(root);
    expect(() => persistSessionRename(store, 'never-saved', 'a new name')).not.toThrow();
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'writes the name when the record is readable',
    async () => {
      const { root } = await projectFixture();
      const store = await createTrustedProjectSessionStoreFixture(root);
      store.save(record());
      persistSessionRename(store, SESSION_ID, 'renamed');

      const outcome = store.load(SESSION_ID);
      if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
      expect(outcome.record.name).toBe('renamed');
    },
  );
});
