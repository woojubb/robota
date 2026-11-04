/**
 * A session that logs before its first save, with keys that are locked (#3679, secure conversation).
 *
 * `Session` writes `session_init` to the replay log before the first persist. With a sealing log sink
 * that line is sealed, and the first persist reads the store to keep the members of a record it does
 * not own: no snapshot yet, and a log this process cannot open. That is a session nobody has saved,
 * not a record to protect: the save writes the snapshot beside the log and destroys nothing. It used
 * to be refused, on every turn, as "not overwritten".
 *
 * ARCH-047: a project write needs the Linux stable-root host, so these cases are Linux-only like the
 * rest of the project store's tests.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { WorkspaceSessionLogSink, createProjectSessionStore } from '../session-persistence.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

const testHost = createTestFrameworkHost();

const linux = process.platform === 'linux';
const CANARY = 'CANARY-77d1c0-first-persist';

const directories: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.runIf(linux)(
  'a locked writer saving a session its sealed replay log already names',
  () => {
    it('writes the first snapshot sealed instead of refusing it', async () => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'framework-first-persist-')));
      directories.push(cwd);
      const access = await createTrustedProjectAccessFixture(cwd);
      if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
      const sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
      const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
      const sealer = createTestArtifactSealer();
      // Locked from the start: sealing needs only the public key, so the process can write.
      sealer.lock();
      const store = createProjectSessionStore(sessions, logs, { sealing: { sealer } });

      const interactive = new InteractiveSession({
        host: testHost,
        cwd,
        projectAccess: access,
        sessionStore: store,
        sessionLogSink: new WorkspaceSessionLogSink(logs, { sealing: { sealer } }),
        provider: createScriptedProvider([{ text: `an answer ${CANARY}` }]).provider,
        bare: true,
        defaultTools: [],
      });
      closers.push(() => interactive.shutdown());
      const handle = await interactive.submit(`a question ${CANARY}`);
      await handle.completed;

      const sessionDirectory = join(cwd, '.agent', 'sessions');
      // Records are the `.json` files; the writer markers live beside them in `claims/`.
      const files = (existsSync(sessionDirectory) ? readdirSync(sessionDirectory) : []).filter(
        (name) => name.endsWith('.json'),
      );
      expect(files).toHaveLength(1);
      const snapshot = readFileSync(join(sessionDirectory, files[0]!));
      expect(snapshot.subarray(0, 4).toString('ascii')).toBe('RSL1');
      expect(snapshot.includes(Buffer.from(CANARY))).toBe(false);

      // The conversation is there for the next unlock.
      sealer.unlock();
      const id = files[0]!.slice(0, -'.json'.length);
      const loaded = store.load(id);
      expect(loaded.status).toBe('valid');
      expect(JSON.stringify(loaded.status === 'valid' ? loaded.record.messages : [])).toContain(
        CANARY,
      );
    });

    it('keeps telling a reader that is not about to write that the session is locked', async () => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'framework-first-persist-')));
      directories.push(cwd);
      const access = await createTrustedProjectAccessFixture(cwd);
      if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
      const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
      const sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
      const sealer = createTestArtifactSealer();
      const sink = new WorkspaceSessionLogSink(logs, { sealing: { sealer } });
      sink.append(
        'sess_logged',
        `${JSON.stringify({
          version: 1,
          event: 'session_init',
          sessionId: 'sess_logged',
          timestamp: '2026-11-04T00:00:00.000Z',
          cwd,
        })}\n`,
      );
      sealer.lock();

      const store = createProjectSessionStore(sessions, logs, { sealing: { sealer } });

      // A resume or a listing must never take a log it cannot open for an absent session.
      expect(store.load('sess_logged', { hold: true })).toEqual({ status: 'locked' });
      expect(store.scan?.().locked).toBe(1);
      // The writer, and only the writer, is told there is nothing to protect.
      expect(store.loadHeld?.('sess_logged')).toEqual({ status: 'missing' });
      expect(store.loadHeld?.('sess_never_seen')).toBeUndefined();
    });
  },
);
