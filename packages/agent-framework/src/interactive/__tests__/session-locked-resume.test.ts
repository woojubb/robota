/**
 * Resuming, renaming and autosaving a sealed session around a lock (#3679, secure conversation).
 *
 * The defect these exist for: a resume that ignores what the store said starts an EMPTY session
 * under the sealed session's id, and after an unlock the first autosave replaces the sealed
 * conversation with that empty one. A resume therefore accepts a record it read or a session that
 * was never saved, and nothing else; a rename keeps working for a session its process holds; and a
 * save the store refuses is said once, not dropped in silence on every turn.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface-session/testing';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { SealedSessionUnreadableError } from '@robota-sdk/agent-session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { persistSessionRename } from '../interactive-session-rename.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

const testHost = createTestFrameworkHost();

const CANARY = 'CANARY-9a7c1e-sealed-conversation';

class TestInteractive extends InteractiveSession {
  ready(): Promise<void> {
    return this.ensureInitialized();
  }
}

const closers: Array<() => Promise<void>> = [];
const directories: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'framework-locked-resume-')));
  directories.push(value);
  return value;
}

function sealedRecord(id: string, cwd: string): IInteractiveSessionRecord {
  return {
    id,
    name: 'kept name',
    cwd,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:10:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: CANARY,
        timestamp: new Date('2026-09-01T00:01:00.000Z'),
        state: 'complete',
      },
      {
        id: 'm-1',
        role: 'assistant',
        content: 'an answer worth keeping',
        timestamp: new Date('2026-09-01T00:02:00.000Z'),
        state: 'complete',
      },
    ],
    history: [],
  };
}

function interactiveOptions(cwd: string, store: IInteractiveSessionStore, resumeSessionId: string) {
  return {
    host: testHost,
    cwd,
    sessionStore: store,
    resumeSessionId,
    provider: createScriptedProvider([{ text: 'a fresh reply' }]).provider,
    bare: true,
    defaultTools: [],
  } as const;
}

describe('resuming a sealed session whose keys are locked', () => {
  it('is refused, so an unlock and a save afterwards cannot replace the conversation', async () => {
    const cwd = directory();
    const sessions = directory();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(sessions, { sealing: { sealer } }).save(sealedRecord('sess_sealed', cwd));
    sealer.lock();
    // A restarted process: its store has never written or read this session.
    const store = new NodeSessionStore(sessions, { sealing: { sealer } });

    let refusal: unknown;
    let interactive: TestInteractive | undefined;
    try {
      interactive = new TestInteractive(interactiveOptions(cwd, store, 'sess_sealed'));
      closers.push(() => interactive!.shutdown());
    } catch (error) {
      refusal = error;
    }
    if (interactive !== undefined) {
      // What the defect did: the session started empty, the keys unlocked, a turn ran and saved.
      await interactive.ready();
      sealer.unlock();
      const handle = await interactive.submit('hello again');
      await handle.completed;
    }
    sealer.unlock();

    const stored = store.load('sess_sealed');
    if (stored.status !== 'valid') throw new Error(`expected valid, got ${stored.status}`);
    expect(JSON.stringify(stored.record.messages)).toContain(CANARY);
    expect(stored.record.messages).toHaveLength(2);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe(
      'Cannot resume session sess_sealed: it is sealed and locked; unlock to open it.',
    );
  });

  it('refuses a corrupt record too, and still starts a never-saved id as a new session', async () => {
    const cwd = directory();
    const sessions = directory();
    const sealer = createTestArtifactSealer();
    // Sealed with keys this process does not hold: it does not open, which is `corrupt`.
    new NodeSessionStore(sessions, {
      sealing: { sealer: createTestArtifactSealer() },
    }).save(sealedRecord('sess_other', cwd));
    const store = new NodeSessionStore(sessions, { sealing: { sealer } });

    expect(() => new TestInteractive(interactiveOptions(cwd, store, 'sess_other'))).toThrow(
      'Cannot resume session sess_other: the session store reported "corrupt" for its record.',
    );

    const fresh = new TestInteractive(interactiveOptions(cwd, store, 'sess_never_saved'));
    closers.push(() => fresh.shutdown());
    await fresh.ready();
    expect(store.load('sess_never_saved').status).toBe('valid');
  });

  it('refuses a locked source for a fork as well', () => {
    const cwd = directory();
    const sessions = directory();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(sessions, { sealing: { sealer } }).save(sealedRecord('sess_sealed', cwd));
    sealer.lock();
    const store = new NodeSessionStore(sessions, { sealing: { sealer } });

    expect(
      () =>
        new TestInteractive({
          ...interactiveOptions(cwd, store, 'sess_sealed'),
          forkSession: true,
        } as never),
    ).toThrow('Cannot resume session sess_sealed: it is sealed and locked; unlock to open it.');
  });
});

describe('renaming a sealed session its process holds', () => {
  it('goes on working after the keys lock, keeping the conversation', () => {
    const sessions = directory();
    const sealer = createTestArtifactSealer();
    const writer = new NodeSessionStore(sessions, { sealing: { sealer } });
    writer.save(sealedRecord('sess_sealed', '/work'));
    sealer.lock();

    persistSessionRename(writer, 'sess_sealed', 'renamed while locked');

    sealer.unlock();
    const stored = writer.load('sess_sealed');
    if (stored.status !== 'valid') throw new Error(`expected valid, got ${stored.status}`);
    expect(stored.record.name).toBe('renamed while locked');
    expect(JSON.stringify(stored.record.messages)).toContain(CANARY);
  });
});

describe('a save the store refuses', () => {
  it('is reported once for the session, not on every save and not never', async () => {
    const cwd = directory();
    const saves: string[] = [];
    const refusing: IInteractiveSessionStore = withHoldReadClaim({
      load: () => ({ status: 'missing' }) as const,
      list: () => [],
      save: (record: IInteractiveSessionRecord) => {
        saves.push(record.id);
        throw new SealedSessionUnreadableError(record.id, 'locked');
      },
      delete: () => undefined,
    });
    const interactive = new TestInteractive({
      host: testHost,
      cwd,
      sessionStore: refusing,
      provider: createScriptedProvider([]).provider,
      bare: true,
      defaultTools: [],
    });
    closers.push(() => interactive.shutdown());
    const errors: Error[] = [];
    interactive.on('error', (error) => errors.push(error));

    // Every one of these saves the session; the store refuses each.
    await interactive.ready();
    await interactive.setPlan('an objective');
    interactive.approvePlan();
    interactive.revertPlan();

    expect(saves.length).toBeGreaterThanOrEqual(4);
    const notices = interactive
      .getFullHistory()
      .filter((entry) => JSON.stringify(entry).includes('was not overwritten'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SealedSessionUnreadableError);
    expect(notices).toHaveLength(1);
  });
});

describe("a refused save says why, in the store's own words", () => {
  function refusals(interactive: InteractiveSession): SealedSessionUnreadableError[] {
    const errors: SealedSessionUnreadableError[] = [];
    interactive.on('error', (error) => {
      if (error instanceof SealedSessionUnreadableError) errors.push(error);
    });
    return errors;
  }

  it('tells a process with no keys that nothing here opens the file, never to unlock', async () => {
    const cwd = directory();
    const sessions = directory();
    // Built plain, as the product builds it until secure mode exists.
    const interactive = new TestInteractive({
      host: testHost,
      cwd,
      sessionStore: new NodeSessionStore(sessions, { sealing: 'plain' }),
      provider: createScriptedProvider([]).provider,
      bare: true,
      defaultTools: [],
    });
    closers.push(() => interactive.shutdown());
    const errors = refusals(interactive);
    await interactive.ready();
    // Another writer seals a record under this session's id.
    new NodeSessionStore(sessions, {
      sealing: { sealer: createTestArtifactSealer() },
    }).save(sealedRecord(interactive.sessionId, cwd));

    await interactive.setPlan('an objective');

    expect(errors.map((error) => error.reason)).toEqual(['no-keys']);
    expect(errors[0]?.message).not.toMatch(/unlock/i);
  });

  // #3679 step 3e: the session claims its id, and while the keys are locked a sealed file it cannot
  // open may be the owner's own other process's write, so only the unlock can tell; the store says
  // the keys are locked, and the session decides at the unlock (see `session-divergence.test.ts`).
  it('tells a process that runs the session that the locked keys stand in the way of a changed file', async () => {
    const cwd = directory();
    const sessions = directory();
    const sealer = createTestArtifactSealer();
    const interactive = new TestInteractive({
      host: testHost,
      cwd,
      sessionStore: new NodeSessionStore(sessions, { sealing: { sealer } }),
      provider: createScriptedProvider([]).provider,
      bare: true,
      defaultTools: [],
    });
    closers.push(() => interactive.shutdown());
    const errors = refusals(interactive);
    await interactive.ready();
    await interactive.setPlan('an objective');
    sealer.lock();
    // Someone else replaces the file with another sealed record while this process holds the session.
    writeFileSync(
      join(sessions, `${interactive.sessionId}.json`),
      sealer.sealBytes(Buffer.from('{}'), { kind: 'session-record', id: interactive.sessionId }),
    );

    interactive.approvePlan();

    expect(errors.map((error) => error.reason)).toEqual(['locked']);
  });

  it('is reported again after a save in between went through', async () => {
    const cwd = directory();
    let refuse = true;
    const store: IInteractiveSessionStore = withHoldReadClaim({
      load: () => ({ status: 'missing' }) as const,
      list: () => [],
      save: (record: IInteractiveSessionRecord) => {
        if (refuse) throw new SealedSessionUnreadableError(record.id, 'locked');
      },
      delete: () => undefined,
    });
    const interactive = new TestInteractive({
      host: testHost,
      cwd,
      sessionStore: store,
      provider: createScriptedProvider([]).provider,
      bare: true,
      defaultTools: [],
    });
    closers.push(() => interactive.shutdown());
    const errors = refusals(interactive);
    await interactive.ready();
    await interactive.setPlan('an objective');
    refuse = false;
    interactive.approvePlan();
    refuse = true;
    interactive.revertPlan();

    expect(errors).toHaveLength(2);
  });
});
