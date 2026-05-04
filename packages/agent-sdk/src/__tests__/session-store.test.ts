import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '@robota-sdk/agent-sessions';
import type { ISessionRecord } from '@robota-sdk/agent-sessions';
import { createProjectSessionStore } from '../interactive/session-persistence.js';

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

describe('SessionStore', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'robota-session-test-'));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save and load', () => {
    it('saves a session and loads it back by id', () => {
      const record = makeRecord();
      store.save(record);
      const loaded = store.load(record.id);
      expect(loaded).toEqual(record);
    });

    it('preserves all fields including messages', () => {
      const record = makeRecord({
        id: 'msg-session',
        name: 'My Session',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'world' },
        ],
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
      const loaded = store.load(record.id);
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

      const updated = { ...record, updatedAt: '2024-06-01T00:00:00.000Z', messages: [{ x: 1 }] };
      store.save(updated);

      const loaded = store.load(record.id);
      expect(loaded?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      expect(loaded?.messages).toHaveLength(1);
    });
  });

  describe('load', () => {
    it('returns undefined for a missing session', () => {
      const result = store.load('nonexistent-id');
      expect(result).toBeUndefined();
    });

    it('falls back to append-only replay logs when project session json is missing', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'robota-project-session-'));
      const logsDir = join(cwd, '.robota', 'logs');
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(
        join(logsDir, 'log-only-session.jsonl'),
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
        'utf-8',
      );

      try {
        const projectStore = createProjectSessionStore(cwd);
        const loaded = projectStore.load('log-only-session');

        expect(loaded?.cwd).toBe(cwd);
        expect(loaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
        expect(loaded?.history).toHaveLength(2);
        expect(loaded?.backgroundTasks?.map((task) => task.id)).toEqual(['task-1']);
        expect(loaded?.backgroundJobGroups?.map((group) => group.id)).toEqual(['group-1']);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions exist', () => {
      expect(store.list()).toEqual([]);
    });

    it('lists all saved sessions', () => {
      store.save(makeRecord({ id: 'a', updatedAt: '2024-01-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'b', updatedAt: '2024-01-02T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'c', updatedAt: '2024-01-03T00:00:00.000Z' }));
      const sessions = store.list();
      expect(sessions).toHaveLength(3);
    });

    it('sorts sessions by updatedAt descending (most recent first)', () => {
      store.save(makeRecord({ id: 'old', updatedAt: '2024-01-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'new', updatedAt: '2024-03-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'mid', updatedAt: '2024-02-01T00:00:00.000Z' }));
      const sessions = store.list();
      expect(sessions[0].id).toBe('new');
      expect(sessions[1].id).toBe('mid');
      expect(sessions[2].id).toBe('old');
    });

    it('returns empty array when base directory does not exist', () => {
      const nonExistentStore = new SessionStore(join(tmpDir, 'does-not-exist'));
      expect(nonExistentStore.list()).toEqual([]);
    });
  });

  describe('delete', () => {
    it('deletes a session by id', () => {
      const record = makeRecord();
      store.save(record);
      store.delete(record.id);
      expect(store.load(record.id)).toBeUndefined();
    });

    it('does not throw when deleting a nonexistent session', () => {
      expect(() => store.delete('nonexistent-id')).not.toThrow();
    });

    it('removes the session from list after deletion', () => {
      store.save(makeRecord({ id: 'keep' }));
      store.save(makeRecord({ id: 'remove' }));
      store.delete('remove');
      const sessions = store.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('keep');
    });
  });

  describe('history field', () => {
    it('saves and loads a record with history field', () => {
      const record = makeRecord({
        id: 'history-session',
        history: [
          { category: 'chat', role: 'user', content: 'hello' },
          { category: 'event', type: 'tool-call', name: 'read' },
          { category: 'chat', role: 'assistant', content: 'world' },
        ],
      });
      store.save(record);
      const loaded = store.load(record.id);
      expect(loaded?.history).toHaveLength(3);
      expect(loaded?.history).toEqual(record.history);
    });

    it('round-trips history entries with different categories', () => {
      const historyEntries = [
        { category: 'chat', role: 'user', content: 'What is 2+2?' },
        { category: 'event', type: 'thinking', text: 'calculating...' },
        { category: 'chat', role: 'assistant', content: '4' },
      ];
      const record = makeRecord({ id: 'roundtrip', history: historyEntries });
      store.save(record);
      const loaded = store.load(record.id);
      expect(loaded?.history).toEqual(historyEntries);
    });

    it('defaults history to undefined when not provided', () => {
      const record = makeRecord({ id: 'no-history' });
      store.save(record);
      const loaded = store.load(record.id);
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

      const projectA = store.list().filter((s) => s.cwd === '/project-a');
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

      const sessions = store.list();
      const found = sessions.find((s) => s.name === 'my-feature');
      expect(found).toBeDefined();
      expect(found!.id).toBe('abc');
    });
  });

  describe('directory creation', () => {
    it('creates the base directory on first save', () => {
      const nestedDir = join(tmpDir, 'nested', 'sessions');
      const nestedStore = new SessionStore(nestedDir);
      nestedStore.save(makeRecord({ id: 'first' }));
      const loaded = nestedStore.load('first');
      expect(loaded?.id).toBe('first');
    });
  });
});
