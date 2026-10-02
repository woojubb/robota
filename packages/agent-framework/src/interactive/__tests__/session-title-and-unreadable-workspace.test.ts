/**
 * #3289 §1 — a stable session title, unreadable records filtered to this workspace, and an existing
 * empty session reused instead of piling up another one.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessage, createUserMessage } from '@robota-sdk/agent-core';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listResumableSessionSummaries,
  listUnreadableSessionsForWorkspace,
  resolveReusableEmptySessionId,
} from '../session-persistence.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const dirs: string[] = [];

function newStoreDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-sdk-session-title-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function record(overrides: Partial<IInteractiveSessionRecord> = {}): IInteractiveSessionRecord {
  return {
    id: 'session_title_1',
    cwd: '/work/project',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:01:00.000Z',
    messages: [],
    ...overrides,
  };
}

describe('session title (#3289 §1)', () => {
  it('is the first user message, one line, Markdown markers stripped', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(
      record({
        messages: [
          createUserMessage('## Task Tracker\n\nCan you build a **task-tracker** app?'),
          createAssistantMessage('Sure — starting now.'),
        ],
      }),
    );
    const [summary] = listResumableSessionSummaries(store, '/work/project');
    expect(summary?.title).toBe('Task Tracker Can you build a task-tracker app?');
  });

  it('is unaffected by later assistant replies, unlike `preview`', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(
      record({
        messages: [
          createUserMessage('what does createTask do?'),
          createAssistantMessage('## Overview\n\n`createTask` creates a task.'),
        ],
      }),
    );
    const [summary] = listResumableSessionSummaries(store, '/work/project');
    expect(summary?.title).toBe('what does createTask do?');
    // `preview` stays the raw latest assistant reply — a different field, for a different consumer.
    expect(summary?.preview).toContain('## Overview');
  });

  it('truncates a long first message with an ellipsis around 60 characters', () => {
    const store = new NodeSessionStore(newStoreDir());
    const long = 'x'.repeat(120);
    store.save(record({ messages: [createUserMessage(long)] }));
    const [summary] = listResumableSessionSummaries(store, '/work/project');
    expect(summary?.title?.endsWith('…')).toBe(true);
    expect(summary?.title?.length).toBeLessThanOrEqual(61);
  });

  it('is absent when the session has no user message yet', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ messages: [createAssistantMessage('hello')] }));
    const [summary] = listResumableSessionSummaries(store, '/work/project');
    expect(summary).not.toHaveProperty('title');
  });
});

describe('listUnreadableSessionsForWorkspace (#3289 §1)', () => {
  it('reports only unreadable records whose raw cwd matches this workspace', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    // A legacy pre-envelope record for THIS workspace: readable enough to peek its cwd, not enough
    // to decode fully (no envelope).
    writeFileSync(
      join(dir, 'mine.json'),
      JSON.stringify({ id: 'mine', cwd: '/work/project', createdAt: 'x', updatedAt: 'x', messages: [] }),
      'utf-8',
    );
    // The same shape, for a DIFFERENT workspace.
    writeFileSync(
      join(dir, 'theirs.json'),
      JSON.stringify({ id: 'theirs', cwd: '/work/other', createdAt: 'x', updatedAt: 'x', messages: [] }),
      'utf-8',
    );
    // Truncated bytes: not even a peekable cwd.
    writeFileSync(join(dir, 'unknown.json'), '{"cwd": "/work/proj', 'utf-8');

    const unreadable = listUnreadableSessionsForWorkspace(store, '/work/project');
    expect(unreadable.map((entry) => entry.id)).toEqual(['mine']);
  });

  it('reports nothing for a workspace with no unreadable records of its own', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    writeFileSync(
      join(dir, 'theirs.json'),
      JSON.stringify({ id: 'theirs', cwd: '/work/other', createdAt: 'x', updatedAt: 'x', messages: [] }),
      'utf-8',
    );
    expect(listUnreadableSessionsForWorkspace(store, '/work/project')).toEqual([]);
  });
});

describe('resolveReusableEmptySessionId (#3289 §1)', () => {
  it('finds an existing empty session of this workspace with no client on it', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ id: 'session_empty', messages: [], updatedAt: '2026-05-05T00:05:00.000Z' }));
    store.save(
      record({
        id: 'session_full',
        messages: [createUserMessage('hi')],
        updatedAt: '2026-05-05T00:06:00.000Z',
      }),
    );
    expect(resolveReusableEmptySessionId(store, '/work/project')).toBe('session_empty');
  });

  it('skips an empty session another client is on', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ id: 'session_empty', messages: [] }));
    const reused = resolveReusableEmptySessionId(store, '/work/project', {
      otherClientsOf: (id) => (id === 'session_empty' ? 1 : 0),
    });
    expect(reused).toBeUndefined();
  });

  it('skips the excluded session id', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ id: 'session_empty', messages: [] }));
    expect(
      resolveReusableEmptySessionId(store, '/work/project', { excludeSessionId: 'session_empty' }),
    ).toBeUndefined();
  });

  it('finds nothing when every session already has messages', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ id: 'session_full', messages: [createUserMessage('hi')] }));
    expect(resolveReusableEmptySessionId(store, '/work/project')).toBeUndefined();
  });

  it('skips an empty session that is busy, even with no client on it', () => {
    // A background task or a self-paced loop outlives the client that started it — a live session
    // with zero clients can still have work of its own in progress.
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ id: 'session_empty', messages: [] }));
    const reused = resolveReusableEmptySessionId(store, '/work/project', {
      isBusy: (id) => id === 'session_empty',
    });
    expect(reused).toBeUndefined();
  });

  it('reuses an empty session that is live but not busy', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record({ id: 'session_empty', messages: [] }));
    const reused = resolveReusableEmptySessionId(store, '/work/project', {
      isBusy: () => false,
    });
    expect(reused).toBe('session_empty');
  });
});
