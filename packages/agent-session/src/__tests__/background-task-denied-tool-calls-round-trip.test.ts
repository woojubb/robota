/**
 * Issue #3288 §1 — a persisted `agent`-kind background task result carrying `deniedToolCalls`
 * round-trips. `deniedToolCalls` was added to `IAgentBackgroundTaskResult` without a matching entry
 * in `decodeBackgroundTaskResult`'s declared-key allow-list (`background-task-members.ts`), so a
 * session record persisted after a subagent had a tool call refused was reported `corrupt` on the
 * very next load — "unknown key; the record contract does not declare it" — exactly the failure this
 * test proves does not happen, mirroring `background-task-tool-call-round-trip.test.ts` (TC-22).
 */

import { describe, expect, it } from 'vitest';

import { decodeInteractiveSessionRecord } from '../session-record-codec/index.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function agentTaskWithDenialsRecord(): IInteractiveSessionRecord {
  return {
    id: 'session-denied-tool-calls-1',
    cwd: '/work',
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:05:00.000Z',
    messages: [],
    backgroundTasks: [
      {
        id: 'task-agent-1',
        kind: 'agent',
        label: 'general-purpose',
        agentType: 'general-purpose',
        status: 'completed',
        mode: 'background',
        parentSessionId: 'session-denied-tool-calls-1',
        depth: 1,
        cwd: '/work',
        promptPreview: 'count the lines of every file under src/',
        updatedAt: '2026-09-27T00:04:00.000Z',
        startedAt: '2026-09-27T00:01:00.000Z',
        completedAt: '2026-09-27T00:04:00.000Z',
        unread: true,
        result: {
          taskId: 'task-agent-1',
          kind: 'agent',
          output: 'counted what it could',
          deniedToolCalls: {
            total: 3,
            byReason: {
              'denied-by-person': 1,
              'no-approver': 1,
              'approver-error': 1,
              cancelled: 0,
            },
          },
        },
      },
    ],
    backgroundTaskEvents: [
      {
        type: 'background_task_completed',
        task: {
          id: 'task-agent-1',
          kind: 'agent',
          label: 'general-purpose',
          status: 'completed',
          mode: 'background',
          parentSessionId: 'session-denied-tool-calls-1',
          depth: 1,
          cwd: '/work',
          promptPreview: 'count the lines of every file under src/',
          updatedAt: '2026-09-27T00:04:00.000Z',
          unread: true,
        },
      },
    ],
  };
}

/** The record as it comes back off disk: JSON, so it matches what `record-decoder.ts` actually reads. */
function persisted(record: IInteractiveSessionRecord): unknown {
  return JSON.parse(JSON.stringify(record)) as unknown;
}

describe('a persisted agent-task result carrying `deniedToolCalls` round-trips (#3288 §1)', () => {
  it('decodes to valid, not corrupt', () => {
    const outcome = decodeInteractiveSessionRecord(persisted(agentTaskWithDenialsRecord()));
    if (outcome.status !== 'valid') {
      throw new Error(`expected valid, got ${outcome.status}: ${JSON.stringify(outcome, null, 2)}`);
    }
    expect(outcome.status).toBe('valid');
  });

  it('preserves the denial summary exactly', () => {
    const record = agentTaskWithDenialsRecord();
    const outcome = decodeInteractiveSessionRecord(persisted(record));
    if (outcome.status !== 'valid') throw new Error('expected valid');
    expect(outcome.record.backgroundTasks?.[0]?.result).toEqual(record.backgroundTasks?.[0]?.result);
  });

  it('reports a corrupt count in `byReason` at its own path, not the whole object', () => {
    const record = persisted(agentTaskWithDenialsRecord()) as {
      backgroundTasks: Array<{ result: { deniedToolCalls: { byReason: Record<string, unknown> } } }>;
    };
    record.backgroundTasks[0]!.result.deniedToolCalls.byReason['no-approver'] = 'nope';
    const outcome = decodeInteractiveSessionRecord(record);
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') {
      expect(outcome.issues.map((issue) => issue.path)).toContain(
        'backgroundTasks[0].result.deniedToolCalls.byReason.no-approver',
      );
    }
  });

  it('rejects an unknown key inside `deniedToolCalls` instead of silently dropping it', () => {
    const record = persisted(agentTaskWithDenialsRecord()) as {
      backgroundTasks: Array<{ result: { deniedToolCalls: Record<string, unknown> } }>;
    };
    record.backgroundTasks[0]!.result.deniedToolCalls['extra'] = true;
    const outcome = decodeInteractiveSessionRecord(record);
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') {
      expect(outcome.issues.map((issue) => issue.path)).toContain(
        'backgroundTasks[0].result.deniedToolCalls.extra',
      );
    }
  });
});
