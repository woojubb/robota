/**
 * CLI-073: --fork-session restores the source conversation into the new
 * session (SPEC: "Creates a new session (fresh UUID) but restores context").
 * The source record stays untouched (append-only invariant).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSessionRecord } from '../interactive-session-restore.js';
import { createTrustedProjectSessionStoreFixture } from '../../testing/trusted-project-state-fixture.js';

import type { IInteractiveSessionStore } from '../session-persistence.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { loadedRecordOrMissing } from './session-load-helpers.js';

const SOURCE_ID = 'cli-073-source-session';

describe('fork restores conversation context (CLI-073)', () => {
  let cwd: string;
  let store: IInteractiveSessionStore;
  let storeFilePath: string | undefined;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-073-'));
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
