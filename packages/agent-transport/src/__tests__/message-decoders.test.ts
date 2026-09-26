import { SESSION_CHANGE_REFUSAL_CODES } from '@robota-sdk/agent-interface-session';
import { describe, expect, it } from 'vitest';

import {
  CLIENT_MESSAGE_SHAPES,
  MAX_INBOUND_FRAME_BYTES,
  SERVER_MESSAGE_SHAPES,
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
} from '../message-decoders.js';

import type { TClientMessage, TServerMessage } from '../wire-messages.js';

/**
 * Issue #2045 — the owner-side runtime decoders. One well-formed sample per union variant round-trips
 * through JSON; a shared malformed corpus (null, arrays, missing fields, wrong primitives, malformed
 * nested values, oversized frames) is refused consistently. Both carriers call these same functions.
 */
const CLIENT_SAMPLES: Readonly<Record<TClientMessage['type'], TClientMessage>> = {
  submit: { type: 'submit', prompt: 'hi' },
  command: { type: 'command', name: 'help', args: 'x', requestId: 'command-1' },
  abort: { type: 'abort' },
  'cancel-queue': { type: 'cancel-queue' },
  'get-messages': { type: 'get-messages' },
  'get-history': { type: 'get-history', fromIndex: 40 },
  'get-prompts': { type: 'get-prompts' },
  'get-context': { type: 'get-context' },
  'get-commands': { type: 'get-commands' },
  'get-status': { type: 'get-status' },
  'list-sessions': { type: 'list-sessions', requestId: 'request-3' },
  'new-session': { type: 'new-session', requestId: 'request-4' },
  'switch-session': { type: 'switch-session', sessionId: 'session-2', requestId: 'request-5' },
  'get-usage-report': { type: 'get-usage-report' },
  'get-personal-usage-report': {
    type: 'get-personal-usage-report',
    requestId: 'request-1',
    period: '7d',
    timezone: 'UTC',
  },
  'get-stored-session-usage-report': {
    type: 'get-stored-session-usage-report',
    requestId: 'request-2',
    sessionId: 'session-1',
  },
  'get-executing': { type: 'get-executing' },
  'get-pending': { type: 'get-pending' },
  'get-execution-workspace': { type: 'get-execution-workspace' },
  'read-execution-detail': {
    type: 'read-execution-detail',
    requestId: 'detail-1',
    entryId: 'main',
    cursor: { offset: 20 },
  },
  'stop-waiting-loop': { type: 'stop-waiting-loop', requestId: 'loop-1' },
  'get-background-tasks': {
    type: 'get-background-tasks',
    filter: { kind: 'agent', includeClosed: true },
  },
  'get-background-task': { type: 'get-background-task', taskId: 't' },
  'get-background-job-groups': { type: 'get-background-job-groups' },
  'get-background-job-group': { type: 'get-background-job-group', groupId: 'g' },
  'wait-background-job-group': { type: 'wait-background-job-group', groupId: 'g' },
  'cancel-background-task': { type: 'cancel-background-task', taskId: 't', reason: 'r' },
  'close-background-task': { type: 'close-background-task', taskId: 't' },
  'send-background-task': { type: 'send-background-task', taskId: 't', input: { prompt: 'p' } },
  'read-background-task-log': {
    type: 'read-background-task-log',
    taskId: 't',
    cursor: { offset: 3 },
  },
  'permission-response': { type: 'permission-response', id: 'p1', result: 'allow-session' },
  'ask-response': { type: 'ask-response', id: 'a1', response: { type: 'answer', values: ['y'] } },
  resume: { type: 'resume', lastSeq: 4 },
  ack: { type: 'ack', seq: 9 },
};

const SERVER_SAMPLES: Readonly<Record<TServerMessage['type'], TServerMessage>> = {
  text_delta: { type: 'text_delta', delta: 'd', driverId: 'drv' },
  user_message: { type: 'user_message', content: 'c' },
  tool_start: { type: 'tool_start', state: {} as never },
  tool_end: { type: 'tool_end', state: {} as never },
  thinking: { type: 'thinking', isThinking: true },
  complete: { type: 'complete', result: {} as never },
  interrupted: { type: 'interrupted', result: {} as never },
  error: { type: 'error', message: 'm' },
  command_result: {
    type: 'command_result',
    name: 'n',
    message: 'm',
    success: true,
    requestId: 'command-1',
  },
  messages: { type: 'messages', messages: [] },
  history: {
    type: 'history',
    startIndex: 3,
    total: 4,
    entries: [
      {
        id: 'e1',
        timestamp: '2026-09-26T01:02:03.004Z',
        category: 'event',
        type: 'skill-activation',
        data: { name: 'review' },
      },
    ],
  },
  context: { type: 'context', state: {} as never },
  history_changed: { type: 'history_changed' },
  turn_source: { type: 'turn_source', source: 'peer' },
  commands: { type: 'commands', commands: [], skills: [] },
  session_status: { type: 'session_status', status: {} as never },
  sessions: { type: 'sessions', requestId: 'request-3', listing: {} as never },
  sessions_error: {
    type: 'sessions_error',
    requestId: 'request-3',
    code: 'list_failed',
    message: 'unreadable store',
  },
  session_switched: { type: 'session_switched', event: { sessionId: 'session-2' } },
  session_change_failed: {
    type: 'session_change_failed',
    code: 'prompt_pending',
    message: 'Answer the pending prompt first.',
    requestId: 'request-5',
  },
  usage_report: { type: 'usage_report', report: {} as never },
  personal_usage_report: {
    type: 'personal_usage_report',
    requestId: 'request-1',
    report: {} as never,
  },
  personal_usage_report_error: {
    type: 'personal_usage_report_error',
    requestId: 'request-1',
    code: 'not_available',
    message: 'not available',
  },
  stored_session_usage_report: {
    type: 'stored_session_usage_report',
    requestId: 'request-2',
    sessionId: 'session-1',
    report: {} as never,
  },
  stored_session_usage_report_error: {
    type: 'stored_session_usage_report_error',
    requestId: 'request-2',
    sessionId: 'session-1',
    code: 'report_failed',
    message: 'not found',
  },
  executing: { type: 'executing', executing: false },
  pending: { type: 'pending', pending: null, pendingCount: 0 },
  execution_workspace_event: { type: 'execution_workspace_event', snapshot: {} as never },
  execution_detail: {
    type: 'execution_detail',
    requestId: 'detail-1',
    page: { entryId: 'main', records: [], nextCursor: { offset: 20 } },
  },
  execution_detail_error: {
    type: 'execution_detail_error',
    requestId: 'detail-1',
    message: 'Unknown entry: main',
  },
  waiting_loop_stop: {
    type: 'waiting_loop_stop',
    requestId: 'loop-1',
    outcome: { kind: 'stopped', loopId: 'loop-a', message: 'Stopped loop-a.' },
  },
  background_task_event: { type: 'background_task_event', event: {} as never },
  background_job_group_event: { type: 'background_job_group_event', event: {} as never },
  plan_event: { type: 'plan_event', event: {} as never },
  context_file_refreshed: { type: 'context_file_refreshed', event: {} as never },
  branch_event: { type: 'branch_event', event: {} as never },
  background_tasks: { type: 'background_tasks', tasks: [] },
  background_task: { type: 'background_task', taskId: 't', task: null },
  background_job_groups: { type: 'background_job_groups', groups: [] },
  background_job_group: { type: 'background_job_group', groupId: 'g', group: null },
  background_task_log: { type: 'background_task_log', taskId: 't', page: {} as never },
  permission_request: { type: 'permission_request', event: {} as never },
  ask_request: { type: 'ask_request', event: {} as never },
  prompt_resolved: { type: 'prompt_resolved', event: {} as never },
  ui_intent: { type: 'ui_intent', event: {} as never },
  session_renamed: { type: 'session_renamed', event: {} as never },
  history_cleared: { type: 'history_cleared' },
  background_task_control_result: {
    type: 'background_task_control_result',
    action: 'cancel',
    taskId: 't',
    success: true,
  },
  protocol_error: { type: 'protocol_error', message: 'm', requestId: 'command-1' },
  resume_gap: { type: 'resume_gap' },
};

const MALFORMED_CLIENT: ReadonlyArray<[string, unknown]> = [
  ['null', null],
  ['an array', [{ type: 'abort' }]],
  ['a string', 'abort'],
  ['no type', { prompt: 'x' }],
  ['a numeric type', { type: 1 }],
  ['an unknown type', { type: 'nope' }],
  ['a prototype-only type', { type: 'toString' }],
  ['submit without prompt', { type: 'submit' }],
  ['submit with an empty prompt', { type: 'submit', prompt: '' }],
  ['submit with an array prompt', { type: 'submit', prompt: ['x'] }],
  ['command with numeric args', { type: 'command', name: 'n', args: 1 }],
  ['get-background-tasks with an array filter', { type: 'get-background-tasks', filter: [] }],
  [
    'get-background-tasks with an unknown kind',
    { type: 'get-background-tasks', filter: { kind: 'x' } },
  ],
  [
    'send-background-task with a string input',
    { type: 'send-background-task', taskId: 't', input: 'p' },
  ],
  [
    'send-background-task with a numeric prompt',
    { type: 'send-background-task', taskId: 't', input: { prompt: 1 } },
  ],
  [
    'read-background-task-log with a string offset',
    { type: 'read-background-task-log', taskId: 't', cursor: { offset: '3' } },
  ],
  [
    'permission-response with a string result',
    { type: 'permission-response', id: 'p', result: 'yes' },
  ],
  [
    'ask-response with values not strings',
    { type: 'ask-response', id: 'a', response: { type: 'answer', values: [1] } },
  ],
  [
    'ask-response cancelled carrying values',
    { type: 'ask-response', id: 'a', response: { type: 'cancelled', values: [] } },
  ],
  ['resume with a string lastSeq', { type: 'resume', lastSeq: '4' }],
  ['ack with NaN', { type: 'ack', seq: Number.NaN }],
  ['cancel-background-task with an empty taskId', { type: 'cancel-background-task', taskId: '' }],
  ['list-sessions without requestId', { type: 'list-sessions' }],
  ['get-history from a negative index', { type: 'get-history', fromIndex: -1 }],
  ['get-history from a fractional index', { type: 'get-history', fromIndex: 1.5 }],
  ['command with an empty requestId', { type: 'command', name: 'n', requestId: '' }],
  ['switch-session with an empty sessionId', { type: 'switch-session', sessionId: '' }],
  [
    'switch-session with a numeric requestId',
    { type: 'switch-session', sessionId: 's', requestId: 1 },
  ],
  ['new-session with an empty requestId', { type: 'new-session', requestId: '' }],
  ['read-execution-detail without requestId', { type: 'read-execution-detail', entryId: 'main' }],
  [
    'read-execution-detail with an empty entryId',
    { type: 'read-execution-detail', requestId: 'r', entryId: '' },
  ],
  [
    'read-execution-detail with a negative offset',
    { type: 'read-execution-detail', requestId: 'r', entryId: 'main', cursor: { offset: -1 } },
  ],
  [
    'read-execution-detail with a string offset',
    { type: 'read-execution-detail', requestId: 'r', entryId: 'main', cursor: { offset: '2' } },
  ],
  ['stop-waiting-loop without requestId', { type: 'stop-waiting-loop' }],
  ['stop-waiting-loop with an empty requestId', { type: 'stop-waiting-loop', requestId: '' }],
];

const MALFORMED_SERVER: ReadonlyArray<[string, unknown]> = [
  ['null', null],
  ['an array', [{ type: 'resume_gap' }]],
  ['an unknown type', { type: 'nope' }],
  ['text_delta without delta', { type: 'text_delta' }],
  ['text_delta with a numeric driverId', { type: 'text_delta', delta: 'd', driverId: 1 }],
  ['tool_start with an array state', { type: 'tool_start', state: [] }],
  ['thinking with a string flag', { type: 'thinking', isThinking: 'yes' }],
  ['messages with a non-array', { type: 'messages', messages: {} }],
  ['messages with a primitive entry', { type: 'messages', messages: ['x'] }],
  ['pending with a number', { type: 'pending', pending: 1, pendingCount: 1 }],
  ['pending with a negative count', { type: 'pending', pending: null, pendingCount: -1 }],
  ['pending with a fractional count', { type: 'pending', pending: 'p', pendingCount: 1.5 }],
  ['background_task with an array task', { type: 'background_task', taskId: 't', task: [] }],
  [
    'control result with an unknown action',
    { type: 'background_task_control_result', action: 'nuke', taskId: 't', success: true },
  ],
  ['command_result without success', { type: 'command_result', name: 'n', message: 'm' }],
  [
    'sessions_error with an unknown code',
    { type: 'sessions_error', requestId: 'r', code: 'nope', message: 'm' },
  ],
  ['session_switched without event', { type: 'session_switched' }],
  [
    'session_change_failed with an unknown code',
    { type: 'session_change_failed', code: 'nope', message: 'm' },
  ],
  ['session_change_failed without message', { type: 'session_change_failed', code: 'limit' }],
  [
    'session_change_failed with a numeric requestId',
    { type: 'session_change_failed', code: 'limit', message: 'm', requestId: 1 },
  ],
  ['history without entries', { type: 'history', startIndex: 0, total: 0 }],
  ['history without its place', { type: 'history', entries: [] }],
  ['history with a negative total', { type: 'history', startIndex: 0, total: -1, entries: [] }],
  ['history with a primitive entry', { type: 'history', startIndex: 0, total: 1, entries: ['x'] }],
  [
    'history with a numeric timestamp',
    {
      type: 'history',
      startIndex: 0,
      total: 1,
      entries: [{ id: 'e', timestamp: 1, category: 'chat', type: 'user' }],
    },
  ],
  [
    'history with an entry missing its category',
    {
      type: 'history',
      startIndex: 0,
      total: 1,
      entries: [{ id: 'e', timestamp: 't', type: 'user' }],
    },
  ],
  [
    'protocol_error with a numeric requestId',
    { type: 'protocol_error', message: 'm', requestId: 1 },
  ],
  ['turn_source with an unknown source', { type: 'turn_source', source: 'robot' }],
  ['turn_source without source', { type: 'turn_source' }],
  ['execution_detail without page', { type: 'execution_detail', requestId: 'r' }],
  ['execution_detail with an array page', { type: 'execution_detail', requestId: 'r', page: [] }],
  ['execution_detail without requestId', { type: 'execution_detail', page: {} }],
  ['execution_detail_error without message', { type: 'execution_detail_error', requestId: 'r' }],
  ['waiting_loop_stop without outcome', { type: 'waiting_loop_stop', requestId: 'r' }],
  [
    'waiting_loop_stop with an unknown kind',
    { type: 'waiting_loop_stop', requestId: 'r', outcome: { kind: 'paused' } },
  ],
  [
    'waiting_loop_stop stopped without loopId',
    { type: 'waiting_loop_stop', requestId: 'r', outcome: { kind: 'stopped' } },
  ],
  [
    'waiting_loop_stop several without message',
    { type: 'waiting_loop_stop', requestId: 'r', outcome: { kind: 'several' } },
  ],
  [
    'waiting_loop_stop failed with a numeric loopId',
    {
      type: 'waiting_loop_stop',
      requestId: 'r',
      outcome: { kind: 'failed', loopId: 1, message: 'm' },
    },
  ],
  [
    'waiting_loop_stop with a prototype-only kind',
    { type: 'waiting_loop_stop', requestId: 'r', outcome: { kind: 'toString' } },
  ],
];

describe('decodeClientMessage (issue #2045)', () => {
  it('has a shape for every union variant and every sample decodes through JSON', () => {
    for (const [type, sample] of Object.entries(CLIENT_SAMPLES)) {
      expect(CLIENT_MESSAGE_SHAPES).toHaveProperty(type);
      expect(decodeClientMessage(JSON.parse(JSON.stringify(sample)))).toEqual({
        ok: true,
        message: sample,
      });
    }
  });

  it.each(MALFORMED_CLIENT)('refuses %s', (_label, value) => {
    expect(decodeClientMessage(value).ok).toBe(false);
  });

  it('keeps the protocol wording for a bad submit prompt', () => {
    expect(decodeClientMessage({ type: 'submit', prompt: 1 })).toEqual({
      ok: false,
      reason: 'prompt must be a non-empty string',
    });
  });
});

describe('decodeServerMessage (issue #2045)', () => {
  it('has a shape for every union variant and every sample decodes through JSON', () => {
    for (const [type, sample] of Object.entries(SERVER_SAMPLES)) {
      expect(SERVER_MESSAGE_SHAPES).toHaveProperty(type);
      expect(decodeServerMessage(JSON.parse(JSON.stringify(sample)))).toEqual({
        ok: true,
        message: sample,
      });
    }
  });

  it.each(MALFORMED_SERVER)('refuses %s', (_label, value) => {
    expect(decodeServerMessage(value).ok).toBe(false);
  });

  it('accepts every refusal code the session contracts declare, and a refusal without requestId', () => {
    for (const code of SESSION_CHANGE_REFUSAL_CODES) {
      expect(decodeServerMessage({ type: 'session_change_failed', code, message: 'm' }).ok).toBe(
        true,
      );
    }
  });

  it('accepts every waiting-loop stop outcome', () => {
    for (const outcome of [
      { kind: 'none' },
      { kind: 'several', message: 'Use /loop stop <id>.' },
      { kind: 'stopped', loopId: 'loop-a' },
      { kind: 'failed', message: 'store unavailable' },
      { kind: 'failed', loopId: 'loop-a', message: 'store unavailable' },
    ]) {
      expect(decodeServerMessage({ type: 'waiting_loop_stop', requestId: 'r', outcome }).ok).toBe(
        true,
      );
    }
  });

  it('accepts a pending frame without its count, as a host from before the count sends it', () => {
    // Refusing it would cut a newer client off from an older daemon on every prompt it queues.
    expect(decodeFrame('{"type":"pending","pending":null}', decodeServerMessage)).toEqual({
      ok: true,
      message: { type: 'pending', pending: null },
    });
  });
});

describe('decodeFrame — the one carrier path', () => {
  it('refuses invalid JSON with the protocol wording and an oversized frame before parsing', () => {
    expect(decodeFrame('not json', decodeClientMessage)).toEqual({
      ok: false,
      reason: 'Invalid JSON',
    });
    const huge = `{"type":"submit","prompt":"${'x'.repeat(MAX_INBOUND_FRAME_BYTES)}"}`;
    expect(decodeFrame(huge, decodeClientMessage)).toEqual({
      ok: false,
      reason: 'Frame too large',
    });
    expect(decodeFrame('{"type":"abort"}', decodeClientMessage)).toEqual({
      ok: true,
      message: { type: 'abort' },
    });
  });
});
