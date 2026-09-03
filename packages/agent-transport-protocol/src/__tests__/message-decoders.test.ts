import { describe, expect, it } from 'vitest';

import {
  CLIENT_MESSAGE_SHAPES,
  MAX_INBOUND_FRAME_BYTES,
  SERVER_MESSAGE_SHAPES,
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
} from '../message-decoders.js';

import type { TClientMessage, TServerMessage } from '../ws-protocol.js';

/**
 * Issue #2045 — the owner-side runtime decoders. One well-formed sample per union variant round-trips
 * through JSON; a shared malformed corpus (null, arrays, missing fields, wrong primitives, malformed
 * nested values, oversized frames) is refused consistently. Both carriers call these same functions.
 */
const CLIENT_SAMPLES: Readonly<Record<TClientMessage['type'], TClientMessage>> = {
  submit: { type: 'submit', prompt: 'hi' },
  command: { type: 'command', name: 'help', args: 'x' },
  abort: { type: 'abort' },
  'cancel-queue': { type: 'cancel-queue' },
  'get-messages': { type: 'get-messages' },
  'get-context': { type: 'get-context' },
  'get-usage-report': { type: 'get-usage-report' },
  'get-executing': { type: 'get-executing' },
  'get-pending': { type: 'get-pending' },
  'get-execution-workspace': { type: 'get-execution-workspace' },
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
  command_result: { type: 'command_result', name: 'n', message: 'm', success: true },
  messages: { type: 'messages', messages: [] },
  context: { type: 'context', state: {} as never },
  usage_report: { type: 'usage_report', report: {} as never },
  executing: { type: 'executing', executing: false },
  pending: { type: 'pending', pending: null },
  execution_workspace_event: { type: 'execution_workspace_event', snapshot: {} as never },
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
  protocol_error: { type: 'protocol_error', message: 'm' },
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
  ['pending with a number', { type: 'pending', pending: 1 }],
  ['background_task with an array task', { type: 'background_task', taskId: 't', task: [] }],
  [
    'control result with an unknown action',
    { type: 'background_task_control_result', action: 'nuke', taskId: 't', success: true },
  ],
  ['command_result without success', { type: 'command_result', name: 'n', message: 'm' }],
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
