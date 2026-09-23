/**
 * MCP-004 §S1 "Session exit and restart" (TC-08): a restored, non-terminal `tool-invocation` task is
 * failed by the EXISTING generic restart reconciliation — no new code path. Modeled directly on
 * `interactive-session-background-tasks.test.ts`'s "marks restored running background tasks as stale".
 */

import { describe, expect, it, vi } from 'vitest';

import { createSessionStub as createSharedSessionStub } from './helpers/session-stub.js';
import { InteractiveSession } from '../interactive-session.js';

function createSessionStoreStub() {
  const records = new Map<string, unknown>();
  return {
    load: vi.fn((id: string) => {
      const record = records.get(id);
      return record === undefined ? { status: 'missing' } : { status: 'valid', record };
    }),
    save: vi.fn((record: { id: string } & Record<string, unknown>) =>
      records.set(record.id, record),
    ),
    list: vi.fn(() =>
      [...records.entries()].map(([id, record]) => ({ id, outcome: { status: 'valid', record } })),
    ),
    delete: vi.fn((id: string) => records.delete(id)),
  };
}

describe('MCP-004 TC-08: restore reconciliation for a tool-invocation task', () => {
  it('marks a restored running tool-invocation task as stale — failed, stale_worker, one synthetic event', () => {
    const sessionStub = createSharedSessionStub({ getSessionId: () => 'session_parent' });
    const sessionStore = createSessionStoreStub();
    sessionStore.save({
      id: 'session_stale_tool_call',
      cwd: '/workspace',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      messages: [],
      history: [],
      backgroundTasks: [
        {
          id: 'tool_invocation_stale',
          kind: 'tool-invocation',
          label: 'SlowTool',
          status: 'running',
          mode: 'background',
          parentSessionId: 'session_stale_tool_call',
          depth: 0,
          cwd: '/workspace',
          updatedAt: '2026-05-01T00:00:00.000Z',
          unread: false,
          commandPreview: 'SlowTool (server-1)',
          metadata: {
            toolName: 'SlowTool',
            serverId: 'server-1',
            sourceName: 'slow_tool',
            securityIdentity: 'identity-1',
            permissionMode: 'default',
            provenanceOwner: 'mcp',
          },
        },
      ],
      backgroundTaskEvents: [],
    });

    new InteractiveSession({
      session: sessionStub,
      sessionStore: sessionStore as never,
      resumeSessionId: 'session_stale_tool_call',
    });

    const lastSaved = sessionStore.save.mock.calls.at(-1)?.[0] as {
      backgroundTasks?: Array<{ id: string; kind: string; status: string; timeoutReason?: string }>;
      backgroundTaskEvents?: Array<{ type: string; task?: { id: string; kind: string } }>;
    };

    expect(lastSaved.backgroundTasks?.[0]).toMatchObject({
      id: 'tool_invocation_stale',
      kind: 'tool-invocation',
      status: 'failed',
      timeoutReason: 'stale_worker',
    });
    const failedEvents = lastSaved.backgroundTaskEvents?.filter(
      (event) => event.type === 'background_task_failed',
    );
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents?.[0]).toMatchObject({
      type: 'background_task_failed',
      task: { id: 'tool_invocation_stale', kind: 'tool-invocation' },
    });
  });
});
