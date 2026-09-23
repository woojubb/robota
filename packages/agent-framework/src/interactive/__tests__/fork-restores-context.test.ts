/**
 * CLI-073: --fork-session restores the source conversation into the new
 * session (SPEC: "Creates a new session (fresh UUID) but restores context").
 * The source record stays untouched (append-only invariant).
 */

import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSessionRecord } from '../interactive-session-restore.js';
import { scriptedSession, type ScriptedSessionHarness } from '../../testing/index.js';
import { createTrustedProjectSessionStoreFixture } from '../../testing/trusted-project-state-fixture.js';

import type { IInteractiveSessionStore } from '../session-persistence.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { loadedRecord, loadedRecordOrMissing } from './session-load-helpers.js';

const SOURCE_ID = 'cli-073-source-session';

// ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
describe.runIf(process.platform === 'linux')('fork restores conversation context (CLI-073)', () => {
  let cwd: string;
  let store: IInteractiveSessionStore;
  let storeFilePath: string | undefined;

  beforeEach(async () => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-073-')));
    store = await createTrustedProjectSessionStoreFixture(cwd);
    store.save({
      id: SOURCE_ID,
      cwd,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
      messages: [
        {
          id: 'm-1',
          role: 'user',
          content: 'Remember the number 42.',
          timestamp: new Date('2026-08-01T00:00:00.000Z'),
          state: 'complete',
        },
        {
          id: 'm-2',
          role: 'assistant',
          content: 'Noted: 42.',
          timestamp: new Date('2026-08-01T00:00:00.000Z'),
          state: 'complete',
        },
      ] as TUniversalMessage[],
    });
    storeFilePath = join(cwd, '.robota', 'sessions', `${SOURCE_ID}.json`);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('TC-01: loadSessionRecord yields the source messages for injection regardless of fork', () => {
    const restored = loadSessionRecord(store, SOURCE_ID, null);

    expect(restored.pendingRestoreMessages).not.toBeNull();
    expect(restored.pendingRestoreMessages).toHaveLength(2);
    expect(restored.pendingRestoreMessages?.[0]).toMatchObject({
      role: 'user',
      content: 'Remember the number 42.',
    });
  });

  it('TC-03: the source record is unmodified after a fork-style load (append-only)', () => {
    const before = storeFilePath !== undefined ? readFileSync(storeFilePath, 'utf8') : undefined;

    loadSessionRecord(store, SOURCE_ID, null);

    const after = storeFilePath !== undefined ? readFileSync(storeFilePath, 'utf8') : undefined;
    expect(before).toBeDefined();
    expect(after).toBe(before);
    expect(loadedRecordOrMissing(store, SOURCE_ID)?.messages).toHaveLength(2);
  });

  it('TC-05: plain resume keeps yielding the messages (regression)', () => {
    const restored = loadSessionRecord(store, SOURCE_ID, null);
    expect(restored.pendingRestoreMessages).toHaveLength(2);
  });
});

/**
 * CLI-1994 TC-04 — the persisted `systemPrompt` stops being a dead field: `loadSessionRecord` reads
 * it back as `restoredSystemPrompt`, and a FORK initialised from the record answers under that exact
 * string. Driven through REAL sessions (the scripted harness, a real `NodeSessionStore`), on every
 * platform: the fixture above needs the Linux-only project mutation, this one does not. RED with the
 * restore read removed — the fork then rebuilds its prompt and the sentinel never reaches it.
 */
describe('a fork inherits the persisted system prompt (CLI-1994 TC-04)', () => {
  const SENTINEL = 'PARENT ASSEMBLED PROMPT — CLI-1994 sentinel';
  const TEST_TIMEOUT = 20_000;
  const open: ScriptedSessionHarness[] = [];
  let sharedCwd: string | undefined;

  function track(harness: ScriptedSessionHarness): ScriptedSessionHarness {
    open.push(harness);
    return harness;
  }

  afterEach(async () => {
    for (const harness of open.splice(0)) await harness.dispose();
    if (sharedCwd) rmSync(sharedCwd, { recursive: true, force: true });
    sharedCwd = undefined;
  });

  /** A persisted parent whose record carries the sentinel as its assembled prompt. */
  async function persistedParent(): Promise<{ cwd: string; id: string; store: NodeSessionStore }> {
    // The test owns the workspace (a harness deletes only one it created), so the parent can be
    // shut down before its record is rewritten and the fork can still read it afterwards.
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-1994-tc04-')));
    sharedCwd = cwd;
    const parent = scriptedSession({ turns: [{ text: 'noted: 42' }], persistence: true, cwd });
    await parent.submit('Remember the number 42');
    const id = parent.session.getSession().getSessionId();
    // Shut the parent down first: its own persist on shutdown would otherwise rewrite the prompt.
    await parent.dispose();
    const store = new NodeSessionStore(join(cwd, '.robota', 'sessions'));
    store.save({ ...loadedRecord(store, id), systemPrompt: SENTINEL });
    return { cwd, id, store };
  }

  it(
    'loadSessionRecord returns restoredSystemPrompt equal to the persisted record.systemPrompt',
    async () => {
      const { id, store } = await persistedParent();

      const restored = loadSessionRecord(store, id, null);

      expect(restored.loadOutcome.status).toBe('valid');
      expect(restored.restoredSystemPrompt).toBe(SENTINEL);
      expect(restored.restoredSystemPrompt).toBe(loadedRecord(store, id).systemPrompt);
    },
    TEST_TIMEOUT,
  );

  it(
    'a fork initialised from the record reports that exact string and sends it as the system head',
    async () => {
      const { cwd, id } = await persistedParent();

      const fork = track(
        scriptedSession({
          turns: [{ text: 'it was 42' }],
          persistence: true,
          cwd,
          resumeSessionId: id,
          forkSession: true,
        }),
      );
      await fork.submit('What number?');

      expect(fork.session.getSession().getSystemMessage()).toBe(SENTINEL);
      expect(fork.requests[0]?.[0]?.role).toBe('system');
      expect(fork.requests[0]?.[0]?.content).toBe(SENTINEL);
      // Still a copy of the conversation, and still a fresh id.
      const contents = (fork.requests[0] ?? []).map((message) => String(message.content));
      expect(contents).toContain('Remember the number 42');
      expect(fork.session.getSession().getSessionId()).not.toBe(id);
    },
    TEST_TIMEOUT,
  );

  it(
    'a record with no systemPrompt still initialises and rebuilds the prompt (the unchanged path)',
    async () => {
      const { cwd, id, store } = await persistedParent();
      const { systemPrompt: _dropped, ...withoutPrompt } = loadedRecord(store, id);
      store.save(withoutPrompt);
      expect(loadSessionRecord(store, id, null).restoredSystemPrompt).toBeUndefined();

      const fork = track(
        scriptedSession({
          turns: [{ text: 'rebuilt' }],
          persistence: true,
          cwd,
          resumeSessionId: id,
          forkSession: true,
        }),
      );
      await fork.submit('What number?');

      const prompt = fork.session.getSession().getSystemMessage();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).not.toBe(SENTINEL);
    },
    TEST_TIMEOUT,
  );
});
