/**
 * MCP-004 §S1 / TC-22 — a session record holding a `tool-invocation` background task round-trips.
 *
 * `TASK_KINDS` (`background-task-members.ts`) is the second kind list DATA-010 exists to eliminate;
 * until it does, every member added to the SSOT `TBackgroundTaskKind` (`agent-interface-execution`)
 * must be mirrored here too, or `decodeBackgroundTaskState` / `decodeBackgroundTaskResult` report an
 * unknown-literal issue and `record-decoder.ts` marks the whole session record `corrupt` — exactly
 * the failure this test proves does not happen for `'tool-invocation'`.
 */

import { describe, expect, it } from 'vitest';

import { decodeInteractiveSessionRecord } from '../session-record-codec/index.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function toolInvocationRecord(): IInteractiveSessionRecord {
  return {
    id: 'session-tool-call-1',
    cwd: '/work',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:05:00.000Z',
    messages: [],
    backgroundTasks: [
      {
        id: 'task-tool-1',
        kind: 'tool-invocation',
        label: 'crawl-site',
        status: 'completed',
        mode: 'background',
        parentSessionId: 'session-tool-call-1',
        depth: 0,
        cwd: '/work',
        updatedAt: '2026-09-22T00:04:00.000Z',
        startedAt: '2026-09-22T00:01:00.000Z',
        completedAt: '2026-09-22T00:04:00.000Z',
        unread: true,
        commandPreview: 'crawl-site',
        metadata: {
          serverId: 'server-1',
          sourceName: 'crawl_site',
          securityIdentity: 'identity-1',
          permissionMode: 'inherit-allowlist',
          provenanceOwner: 'mcp',
          toolName: 'crawl-site',
        },
        result: {
          taskId: 'task-tool-1',
          kind: 'tool-invocation',
          output: 'crawled 42 pages',
        },
      },
    ],
    backgroundTaskEvents: [
      {
        type: 'background_task_completed',
        task: {
          id: 'task-tool-1',
          kind: 'tool-invocation',
          label: 'crawl-site',
          status: 'completed',
          mode: 'background',
          parentSessionId: 'session-tool-call-1',
          depth: 0,
          cwd: '/work',
          updatedAt: '2026-09-22T00:04:00.000Z',
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

describe('a persisted `tool-invocation` background task round-trips (TC-22)', () => {
  it.each([
    { field: 'kind', value: 'agent' },
    { field: 'taskId', value: 'other-task' },
  ])('rejects a persisted result whose $field differs from its task', ({ field, value }) => {
    const record = persisted(toolInvocationRecord()) as IInteractiveSessionRecord;
    const result = record.backgroundTasks?.[0]?.result as unknown as Record<string, unknown>;
    result[field] = value;
    const outcome = decodeInteractiveSessionRecord(record);
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') {
      expect(outcome.issues.map((issue) => issue.path)).toContain(`backgroundTasks[0].result.${field}`);
    }
  });

  it('decodes to valid, not corrupt', () => {
    const outcome = decodeInteractiveSessionRecord(persisted(toolInvocationRecord()));
    if (outcome.status !== 'valid') {
      throw new Error(`expected valid, got ${outcome.status}: ${JSON.stringify(outcome, null, 2)}`);
    }
    expect(outcome.status).not.toBe('corrupt');
  });

  it('preserves the task state and result exactly', () => {
    const record = toolInvocationRecord();
    const outcome = decodeInteractiveSessionRecord(persisted(record));
    if (outcome.status !== 'valid') throw new Error('expected valid');
    expect(outcome.record.backgroundTasks).toEqual(record.backgroundTasks);
    expect(outcome.record.backgroundTaskEvents).toEqual(record.backgroundTaskEvents);
  });

  it('accepts a record already in memory, with no JSON round-trip', () => {
    const outcome = decodeInteractiveSessionRecord(toolInvocationRecord());
    expect(outcome.status).toBe('valid');
  });
});
