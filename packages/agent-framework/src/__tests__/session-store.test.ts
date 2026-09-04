import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { NodeSessionStore } from '@robota-sdk/agent-session';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createProjectSessionStore,
  WorkspaceSessionLogSink,
  WorkspaceSessionLogSource,
} from '../interactive/session-persistence.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { ISessionRecord } from '@robota-sdk/agent-session';
import {
  listedRecords,
  loadedRecordOrMissing,
} from '../interactive/__tests__/session-load-helpers.js';

// TRANS-007: the store is no longer opaque. It used to persist and return the record without
// inspecting it, so these tests crossed the same `as` trust boundary `load` did and asserted the
// store's indifference to what it held. `load` now decodes, which is what issue #2096 asks for —
// distinguishing corrupt from valid IS inspection — so a payload that is not a session record is a
// `corrupt` outcome rather than a value the store hands back.
//
// The literals below are therefore real records. `loosePayload` survives for the one case where an
// unreadable payload is the SUBJECT rather than a shortcut, which after this leaf is a first-class
// outcome rather than a cast.
function loosePayload<T>(value: unknown): T {
  return value as T;
}

/** A message that satisfies the contract, for tests whose subject is persistence rather than shape. */
function testMessage(id: string, role: 'user' | 'assistant', content: string) {
  return {
    id,
    role,
    content,
    timestamp: new Date('2026-08-01T00:00:00.000Z'),
    state: 'complete' as const,
  };
}

/** A history entry that satisfies the contract. */
function testHistoryEntry(id: string, type: string, data: Record<string, unknown>) {
  return {
    id,
    timestamp: new Date('2026-08-01T00:00:00.000Z'),
    category: 'chat',
    type,
    data,
  };
}

function makeRecord(overrides: Partial<ISessionRecord> = {}): ISessionRecord {
  return {
    id: 'test-session-001',
    cwd: '/home/user/project',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T01:00:00.000Z',
    messages: [],
    ...overrides,
  };
}

async function projectStore(cwd: string): Promise<ReturnType<typeof createProjectSessionStore>> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return createProjectSessionStore(
    getWorkspaceProjectStateStorage(access.authority, 'sessions'),
    getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
  );
}

describe('SessionStore', () => {
  let tmpDir: string;
  let store: NodeSessionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'robota-session-test-'));
    store = new NodeSessionStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save and load', () => {
    it('saves a session and loads it back by id', () => {
      const record = makeRecord();
      store.save(record);
      const loaded = loadedRecordOrMissing(store, record.id);
      expect(loaded).toEqual(record);
    });

    // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'persists project session CRUD only through minted project state facets',
      async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'robota-project-session-'));
        try {
          const project = await projectStore(cwd);
          const record = makeRecord({ id: 'authority-session', cwd });

          project.save(record);
          expect(loadedRecordOrMissing(project, record.id)).toEqual(record);
          expect(listedRecords(project)).toEqual([record]);
          project.delete(record.id);
          expect(loadedRecordOrMissing(project, record.id)).toBeUndefined();
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      },
    );

    it('rejects session and log facets derived from different authority instances', async () => {
      const left = mkdtempSync(join(tmpdir(), 'robota-project-session-left-'));
      const right = mkdtempSync(join(tmpdir(), 'robota-project-session-right-'));
      try {
        const leftAccess = await createTrustedProjectAccessFixture(left);
        const rightAccess = await createTrustedProjectAccessFixture(right);
        if (leftAccess.status !== 'trusted' || rightAccess.status !== 'trusted') {
          throw new Error('expected trusted project fixtures');
        }

        expect(() =>
          createProjectSessionStore(
            getWorkspaceProjectStateStorage(leftAccess.authority, 'sessions'),
            getWorkspaceProjectStateStorage(rightAccess.authority, 'session-logs'),
          ),
        ).toThrow(/same workspace authority/);
      } finally {
        rmSync(left, { recursive: true, force: true });
        rmSync(right, { recursive: true, force: true });
      }
    });

    it('preserves all fields including messages', () => {
      const record = makeRecord({
        id: 'msg-session',
        name: 'My Session',
        messages: [testMessage('m-0', 'user', 'hello'), testMessage('m-1', 'assistant', 'world')],
        systemPrompt: 'system prompt with /agent capability',
        toolSchemas: [
          {
            name: 'ExecuteCommand',
            description: 'Execute commands',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });
      store.save(record);
      const loaded = loadedRecordOrMissing(store, record.id);
      expect(loaded?.messages).toHaveLength(2);
      expect(loaded?.name).toBe('My Session');
      expect(loaded?.systemPrompt).toBe('system prompt with /agent capability');
      expect(loaded?.toolSchemas).toEqual([
        {
          name: 'ExecuteCommand',
          description: 'Execute commands',
          parameters: { type: 'object', properties: {} },
        },
      ]);
    });

    it('overwrites an existing session on re-save', () => {
      const record = makeRecord();
      store.save(record);

      const updated = {
        ...record,
        updatedAt: '2024-06-01T00:00:00.000Z',
        messages: [testMessage('m-updated', 'user', 'updated')],
      };
      store.save(updated);

      const loaded = loadedRecordOrMissing(store, record.id);
      expect(loaded?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      expect(loaded?.messages).toHaveLength(1);
    });
  });

  describe('load', () => {
    it('returns undefined for a missing session', () => {
      const result = loadedRecordOrMissing(store, 'nonexistent-id');
      expect(result).toBeUndefined();
    });

    // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'falls back to append-only replay logs when project session json is missing',
      async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'robota-project-session-'));
        const access = await createTrustedProjectAccessFixture(cwd);
        if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
        const logStorage = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
        const sink = new WorkspaceSessionLogSink(logStorage);
        sink.append(
          'log-only-session',
          [
            JSON.stringify({
              timestamp: '2026-05-05T00:00:00.000Z',
              sessionId: 'log-only-session',
              event: 'session_init',
              cwd,
            }),
            JSON.stringify({
              timestamp: '2026-05-05T00:00:01.000Z',
              sessionId: 'log-only-session',
              event: 'history_mutation',
              mutation: 'append_message',
              message: {
                id: 'u1',
                role: 'user',
                content: 'hello',
                state: 'complete',
                timestamp: '2026-05-05T00:00:01.000Z',
              },
            }),
            JSON.stringify({
              timestamp: '2026-05-05T00:00:02.000Z',
              sessionId: 'log-only-session',
              event: 'history_mutation',
              mutation: 'append_message',
              message: {
                id: 'a1',
                role: 'assistant',
                content: 'hi',
                state: 'complete',
                timestamp: '2026-05-05T00:00:02.000Z',
              },
            }),
            JSON.stringify({
              timestamp: '2026-05-05T00:00:03.000Z',
              sessionId: 'log-only-session',
              event: 'background_task_event',
              backgroundEvent: {
                type: 'background_task_completed',
                task: {
                  id: 'task-1',
                  kind: 'process',
                  label: 'Replay task',
                  status: 'completed',
                  mode: 'background',
                  parentSessionId: 'log-only-session',
                  depth: 0,
                  cwd,
                  updatedAt: '2026-05-05T00:00:03.000Z',
                  unread: false,
                },
              },
            }),
            JSON.stringify({
              timestamp: '2026-05-05T00:00:04.000Z',
              sessionId: 'log-only-session',
              event: 'background_job_group_event',
              backgroundJobGroupEvent: {
                type: 'background_job_group_completed',
                group: {
                  id: 'group-1',
                  parentSessionId: 'log-only-session',
                  waitPolicy: 'wait_all',
                  taskIds: ['task-1'],
                  status: 'completed',
                  createdAt: '2026-05-05T00:00:03.000Z',
                  updatedAt: '2026-05-05T00:00:04.000Z',
                  results: [],
                },
              },
            }),
          ].join('\n') + '\n',
        );

        try {
          const sessionStorage = getWorkspaceProjectStateStorage(access.authority, 'sessions');
          const store = createProjectSessionStore(sessionStorage, logStorage);
          const loaded = loadedRecordOrMissing(store, 'log-only-session');

          expect(loaded?.cwd).toBe(cwd);
          expect(loaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
          expect(loaded?.history).toHaveLength(2);
          expect(loaded?.backgroundTasks?.map((task) => task.id)).toEqual(['task-1']);
          expect(loaded?.backgroundJobGroups?.map((group) => group.id)).toEqual(['group-1']);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      },
    );
  });

  describe('project session log degradation', () => {
    // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'enforces the caller-supplied payload read budget',
      async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'robota-project-log-budget-'));
        try {
          const access = await createTrustedProjectAccessFixture(cwd);
          if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
          const storage = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
          const serialized = JSON.stringify('larger than one byte');
          const sha256 = createHash('sha256').update(serialized).digest('hex');
          const sink = new WorkspaceSessionLogSink(storage);
          const reference = sink.writeJson('safe-session', sha256, serialized);
          const source = new WorkspaceSessionLogSource(storage, 'safe-session');

          expect(() => source.readBytes(reference.relativePath, 1)).toThrowError(
            expect.objectContaining({ code: 'MAX_TOTAL_BYTES_EXCEEDED' }),
          );
          expect(() => source.readBytes(reference.relativePath, -1)).toThrowError(
            expect.objectContaining({ code: 'INVALID_LIMIT' }),
          );
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      },
    );

    it('rejects a mismatched payload digest before authority-backed I/O', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'robota-project-log-digest-'));
      try {
        const access = await createTrustedProjectAccessFixture(cwd);
        if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
        const sink = new WorkspaceSessionLogSink(
          getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
        );

        expect(() => sink.writeJson('safe-session', 'a'.repeat(64), '{"safe":true}')).toThrow(
          /sha256/i,
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('warn-only disables logging when the authority-backed log target is linked', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'robota-project-log-failure-'));
      const outside = mkdtempSync(join(tmpdir(), 'robota-project-log-outside-'));
      try {
        mkdirSync(join(cwd, '.robota'), { recursive: true });
        symlinkSync(outside, join(cwd, '.robota', 'logs'));
        const access = await createTrustedProjectAccessFixture(cwd);
        if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
        const sink = new WorkspaceSessionLogSink(
          getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
        );

        expect(() => sink.append('safe-session', '{}\n')).not.toThrow();
        expect(() => sink.append('safe-session', '{}\n')).not.toThrow();
      } finally {
        rmSync(cwd, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions exist', () => {
      expect(listedRecords(store)).toEqual([]);
    });

    it('lists all saved sessions', () => {
      store.save(makeRecord({ id: 'a', updatedAt: '2024-01-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'b', updatedAt: '2024-01-02T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'c', updatedAt: '2024-01-03T00:00:00.000Z' }));
      const sessions = listedRecords(store);
      expect(sessions).toHaveLength(3);
    });

    it('sorts sessions by updatedAt descending (most recent first)', () => {
      store.save(makeRecord({ id: 'old', updatedAt: '2024-01-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'new', updatedAt: '2024-03-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'mid', updatedAt: '2024-02-01T00:00:00.000Z' }));
      const sessions = listedRecords(store);
      expect(sessions[0].id).toBe('new');
      expect(sessions[1].id).toBe('mid');
      expect(sessions[2].id).toBe('old');
    });

    it('returns empty array when base directory does not exist', () => {
      const nonExistentStore = new NodeSessionStore(join(tmpDir, 'does-not-exist'));
      expect(listedRecords(nonExistentStore)).toEqual([]);
    });
  });

  describe('delete', () => {
    it('deletes a session by id', () => {
      const record = makeRecord();
      store.save(record);
      store.delete(record.id);
      expect(loadedRecordOrMissing(store, record.id)).toBeUndefined();
    });

    it('does not throw when deleting a nonexistent session', () => {
      expect(() => store.delete('nonexistent-id')).not.toThrow();
    });

    it('removes the session from list after deletion', () => {
      store.save(makeRecord({ id: 'keep' }));
      store.save(makeRecord({ id: 'remove' }));
      store.delete('remove');
      const sessions = listedRecords(store);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('keep');
    });
  });

  describe('history field', () => {
    it('saves and loads a record with history field', () => {
      const record = makeRecord({
        id: 'history-session',
        history: [
          testHistoryEntry('h-0', 'user', { content: 'hello' }),
          testHistoryEntry('h-1', 'tool-call', { name: 'read' }),
          testHistoryEntry('h-2', 'assistant', { content: 'world' }),
        ],
      });
      store.save(record);
      const loaded = loadedRecordOrMissing(store, record.id);
      expect(loaded?.history).toHaveLength(3);
      expect(loaded?.history).toEqual(record.history);
    });

    it('round-trips history entries with different categories', () => {
      const historyEntries = [
        testHistoryEntry('h-0', 'user', { content: 'What is 2+2?' }),
        testHistoryEntry('h-1', 'thinking', { text: 'calculating...' }),
        testHistoryEntry('h-2', 'assistant', { content: '4' }),
      ];
      const record = makeRecord({
        id: 'roundtrip',
        history: historyEntries,
      });
      store.save(record);
      const loaded = loadedRecordOrMissing(store, record.id);
      expect(loaded?.history).toEqual(historyEntries);
    });

    it('defaults history to undefined when not provided', () => {
      const record = makeRecord({ id: 'no-history' });
      store.save(record);
      const loaded = loadedRecordOrMissing(store, record.id);
      expect(loaded?.history).toBeUndefined();
    });
  });

  describe('cwd filtering and name lookup', () => {
    it('list can be filtered by cwd for --continue logic', () => {
      store.save(
        makeRecord({
          id: 's1',
          cwd: '/project-a',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
        }),
      );
      store.save(
        makeRecord({
          id: 's2',
          cwd: '/project-b',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-03-02T00:00:00Z',
        }),
      );
      store.save(
        makeRecord({
          id: 's3',
          cwd: '/project-a',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-03-03T00:00:00Z',
        }),
      );

      const projectA = listedRecords(store).filter((s) => s.cwd === '/project-a');
      expect(projectA).toHaveLength(2);
      expect(projectA[0].id).toBe('s3'); // most recent
    });

    it('list can find session by name for --resume', () => {
      store.save(
        makeRecord({
          id: 'abc',
          name: 'my-feature',
          cwd: '/tmp',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
        }),
      );

      const sessions = listedRecords(store);
      const found = sessions.find((s) => s.name === 'my-feature');
      expect(found).toBeDefined();
      expect(found!.id).toBe('abc');
    });
  });

  describe('directory creation', () => {
    it('creates the base directory on first save', () => {
      const nestedDir = join(tmpDir, 'nested', 'sessions');
      const nestedStore = new NodeSessionStore(nestedDir);
      nestedStore.save(makeRecord({ id: 'first' }));
      const loaded = loadedRecordOrMissing(nestedStore, 'first');
      expect(loaded?.id).toBe('first');
    });
  });
});
