import { mkdirSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessage, createUserMessage } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import {
  createProjectSessionStore,
  listResumableSessionSummaries,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
} from '../session-persistence.js';

describe('session persistence facade', () => {
  it('creates a project-local session store and resolves resumable summaries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'robota-sdk-session-store-'));
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    const store = createProjectSessionStore(cwd);

    store.save({
      id: 'session_one',
      name: 'first',
      cwd,
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:01:00.000Z',
      messages: [createUserMessage('hello'), createAssistantMessage('first answer\nwith newline')],
    });
    store.save({
      id: 'session_two',
      cwd,
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:02:00.000Z',
      messages: [createAssistantMessage('newer answer')],
    });

    expect(resolveLatestSessionId(store, cwd)).toBe('session_two');
    expect(resolveSessionIdByIdOrName(store, 'first')).toBe('session_one');
    expect(resolveSessionIdByIdOrName(store, 'session_two')).toBe('session_two');
    expect(listResumableSessionSummaries(store, cwd)).toEqual([
      {
        id: 'session_two',
        cwd,
        updatedAt: '2026-05-05T00:02:00.000Z',
        messageCount: 1,
        preview: 'newer answer',
      },
      {
        id: 'session_one',
        name: 'first',
        cwd,
        updatedAt: '2026-05-05T00:01:00.000Z',
        messageCount: 2,
        preview: 'first answer with newline',
      },
    ]);

    rmSync(cwd, { recursive: true, force: true });
  });
});
