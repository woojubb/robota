import { describe, expect, it } from 'vitest';
import { decodeSessionLogEntries, SessionLogDecodeError } from '../session-log-codec/index.js';
import { SESSION_LOG_EVENT } from '../session-log-events.js';
import { replaySessionLogEntries, loadSessionLogEntries } from '../session-log-replay.js';
import { validateSessionReplayLogEntries } from '../session-log-validation.js';

const envelope = {
  schemaVersion: 1,
  timestamp: '2026-09-23T00:00:00.000Z',
  sessionId: 'session-1',
};
const message = {
  id: 'm1',
  role: 'assistant',
  content: 'ok',
  state: 'complete',
  timestamp: envelope.timestamp,
};
const execution = { executionId: 'exec-1', round: 1 };
const backgroundEvent = { type: 'background_task_text_delta', taskId: 'task-1', delta: 'part' };
const groupEvent = {
  type: 'background_job_group_created',
  group: {
    id: 'group-1',
    parentSessionId: 'session-1',
    waitPolicy: 'manual',
    taskIds: [],
    status: 'running',
    createdAt: envelope.timestamp,
    updatedAt: envelope.timestamp,
    results: [],
  },
};
const memoryEvent = { type: 'memory_candidate_queued', at: envelope.timestamp };
const contextState = {
  maxTokens: 100,
  usedTokens: 20,
  usedPercentage: 20,
  remainingPercentage: 80,
};
const fixtures = {
  session_init: {
    cwd: '/workspace',
    systemPromptLength: 1,
    systemPrompt: 'x',
    toolSchemas: [],
    model: 'm',
    provider: 'p',
  },
  session_shutdown: { reason: 'done' },
  session_shutdown_step_error: { step: 'persist', error: 'failed' },
  context: { maxTokens: 10, usedTokens: 2, usedPercentage: 20, remainingPercentage: 80 },
  context_compact: { trigger: 'auto', before: contextState, after: contextState },
  error: { message: 'failed', stack: '', historyLength: 0 },
  history_mutation: { ...execution, mutation: 'append_message', index: 0, message },
  provider_request: { ...execution, provider: 'p', model: 'm', messages: [message], tools: [] },
  provider_native_raw_payload: {
    ...execution,
    provider: 'p',
    payloadKind: 'response',
    sequence: 0,
    payload: { sdk: [1, true, null] },
  },
  provider_stream_raw_delta: { ...execution, sequence: 0, delta: 'x' },
  provider_response_raw: {
    ...execution,
    response: message,
    responseKind: 'provider-normalized-message',
  },
  provider_response_normalized: { ...execution, response: message, toolCallsCount: 0 },
  structured_output_transport: {
    ...execution,
    provider: 'p',
    model: 'm',
    mechanism: 'response_schema',
    provenance: 'catalog',
    sent: true,
    schemaInPrompt: false,
  },
  assistant_message_committed: { ...execution, message },
  tool_execution_request: {
    ...execution,
    toolName: 'Read',
    toolCallId: 'tc1',
    parameters: { path: 'a' },
  },
  tool_execution_result: {
    ...execution,
    toolName: 'Read',
    toolCallId: 'tc1',
    success: true,
    result: { ok: true },
  },
  tool_batch_started: {
    ...execution,
    mode: 'parallel',
    maxConcurrency: 5,
    requestCount: 1,
    tools: ['Read'],
  },
  tool_message_committed: { ...execution, message },
  background_task_event: { backgroundEventType: 'background_task_text_delta', backgroundEvent },
  background_job_group_event: { backgroundJobGroupEvent: groupEvent },
  memory_event: { memoryEvent },
  user: { content: 'hello' },
  pre_run: {
    historyLength: 1,
    historyChars: 100,
    historyEstTokens: 25,
    input: 'hello',
    history: [message],
    model: 'm',
    provider: 'p',
    maxTokens: 1000,
    nativeWebSearchSupported: false,
    nativeWebSearchEnabled: false,
    nativeWebFetchSupported: false,
    nativeWebFetchEnabled: false,
  },
  text_delta: { delta: 'x' },
  assistant: {
    content: 'ok',
    historyLength: 1,
    estimatedChars: 100,
    history: [message],
    historyStructure: [
      { role: 'assistant', contentLength: 2, hasToolCalls: false, toolCallNames: [] },
    ],
  },
  tool_call: { tool: 'Read', args: { path: 'a' } },
  tool_result: { tool: 'Read', success: true, dataChars: 1, truncated: false },
  tool_blocked: { tool: 'Read', reason: 'hook' },
  tool_denied: { tool: 'Read', reason: 'permission' },
  server_tool: { tool: 'web', query: 'find' },
} satisfies Record<
  (typeof SESSION_LOG_EVENT)[keyof typeof SESSION_LOG_EVENT],
  Record<string, unknown>
>;
const malformedField = {
  session_init: 'toolSchemas',
  session_shutdown: 'reason',
  session_shutdown_step_error: 'step',
  context: 'maxTokens',
  context_compact: 'before',
  error: 'historyLength',
  history_mutation: 'message',
  provider_request: 'messages',
  provider_native_raw_payload: 'payloadKind',
  provider_stream_raw_delta: 'sequence',
  provider_response_raw: 'response',
  provider_response_normalized: 'response',
  structured_output_transport: 'mechanism',
  assistant_message_committed: 'message',
  tool_execution_request: 'parameters',
  tool_execution_result: 'success',
  tool_batch_started: 'tools',
  tool_message_committed: 'message',
  background_task_event: 'backgroundEvent',
  background_job_group_event: 'backgroundJobGroupEvent',
  memory_event: 'memoryEvent',
  user: 'content',
  pre_run: 'history',
  text_delta: 'delta',
  assistant: 'historyStructure',
  tool_call: 'args',
  tool_result: 'dataChars',
  tool_blocked: 'reason',
  tool_denied: 'reason',
  server_tool: 'tool',
} satisfies Record<keyof typeof fixtures, string>;

describe('session-log codec', () => {
  it('decodes every declared event and revives nested message dates', () => {
    expect(Object.values(SESSION_LOG_EVENT).sort()).toEqual(Object.keys(fixtures).sort());
    const decoded = decodeSessionLogEntries(
      Object.entries(fixtures).map(([event, payload]) => ({ ...envelope, event, ...payload })),
    );
    expect(decoded).toHaveLength(30);
    const response = decoded.find((entry) => entry.event === 'provider_response_normalized');
    expect(response?.response.timestamp).toBeInstanceOf(Date);
    expect(decodeSessionLogEntries(decoded)).toHaveLength(30);
  });

  it.each(Object.entries(malformedField))('rejects malformed %s payload field', (event, field) => {
    const payload = fixtures[event as keyof typeof fixtures];
    expect(() =>
      decodeSessionLogEntries([{ ...envelope, event, ...payload, [field]: null }]),
    ).toThrow(SessionLogDecodeError);
    try {
      decodeSessionLogEntries([{ ...envelope, event, ...payload, [field]: null }]);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionLogDecodeError);
      expect(
        (error as SessionLogDecodeError).issues.some((issue) =>
          issue.path.startsWith(`[0].${field}`),
        ),
      ).toBe(true);
    }
  });

  it('accepts the forced-summary string and abnormal history correlation fields', () => {
    const decoded = decodeSessionLogEntries([
      { ...envelope, event: 'assistant_message_committed', ...execution, message: 'summary' },
      {
        ...envelope,
        event: 'history_mutation',
        ...execution,
        index: 0,
        mutation: 'append_message',
        message,
        providerError: true,
        usageObservationId: 'usage-1',
        providerId: 'p',
        modelId: 'm',
      },
    ]);
    expect(decoded[0]).toMatchObject({ message: 'summary' });
    expect(decoded[1]).toMatchObject({ providerError: true });
  });

  it.each([
    ['session_init', 'toolSchemas', [null], '[0]'],
    ['provider_request', 'messages', [{ ...message, role: 'bogus' }], '[0]'],
    [
      'provider_response_normalized',
      'response',
      { ...message, timestamp: 'not-a-date' },
      'timestamp',
    ],
    [
      'assistant',
      'historyStructure',
      [{ role: 'assistant', contentLength: '2', hasToolCalls: false, toolCallNames: [] }],
      'contentLength',
    ],
    ['background_task_event', 'backgroundEvent', { ...backgroundEvent, delta: 2 }, 'delta'],
    [
      'background_job_group_event',
      'backgroundJobGroupEvent',
      { ...groupEvent, group: { ...groupEvent.group, taskIds: [3] } },
      'taskIds',
    ],
    ['memory_event', 'memoryEvent', { ...memoryEvent, at: 'not-a-date' }, 'at'],
    ['provider_native_raw_payload', 'payload', { nested: undefined }, 'nested'],
  ] as const)('locates malformed nested %s payload', (event, field, bad, fragment) => {
    const payload = { ...fixtures[event], [field]: bad };
    expect(() => decodeSessionLogEntries([{ ...envelope, event, ...payload }])).toThrow(
      SessionLogDecodeError,
    );
    try {
      decodeSessionLogEntries([{ ...envelope, event, ...payload }]);
    } catch (error) {
      expect(
        (error as SessionLogDecodeError).issues.some((issue) => issue.path.includes(fragment)),
      ).toBe(true);
    }
  });

  it('rejects unknown events and versions without including payload content in diagnostics', () => {
    expect(() => decodeSessionLogEntries([{ ...envelope, event: 'secret-prompt' }])).toThrowError(
      /declared event/,
    );
    const unsupported = [
      { ...envelope, schemaVersion: 2, event: 'user', content: 'secret-prompt' },
    ];
    expect(() => decodeSessionLogEntries(unsupported)).toThrow(SessionLogDecodeError);
    try {
      decodeSessionLogEntries(unsupported);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_VERSION',
        schemaVersion: 2,
        issues: [{ path: '[0].schemaVersion', message: expect.any(String) }],
      });
      expect(String(error)).not.toContain('secret-prompt');
    }
  });

  it('rejects malformed direct input before replay and completeness checks', () => {
    const invalid = [
      {
        ...envelope,
        event: 'history_mutation',
        mutation: 'append_message',
        index: 0,
        message: { ...message, id: undefined },
      },
    ];
    expect(() => replaySessionLogEntries(invalid)).toThrow(SessionLogDecodeError);
    expect(() => validateSessionReplayLogEntries(invalid)).toThrow(SessionLogDecodeError);
  });

  it('rejects sparse and non-JSON opaque payloads without partial recovery', () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = { ...envelope, event: 'user', content: 'ok' };
    expect(() => decodeSessionLogEntries(sparse)).toThrowError(/\[0\]/);
    expect(() =>
      decodeSessionLogEntries([
        {
          ...envelope,
          event: 'provider_native_raw_payload',
          ...fixtures.provider_native_raw_payload,
          payload: new Map([['secret', 'value']]),
        },
      ]),
    ).toThrow(SessionLogDecodeError);
  });

  it('rejects missing schema version and does not infer a missing message date', () => {
    expect(() =>
      decodeSessionLogEntries([
        {
          timestamp: envelope.timestamp,
          sessionId: envelope.sessionId,
          event: 'user',
          content: 'ok',
        },
      ]),
    ).toThrowError(/schemaVersion/);
    expect(() =>
      decodeSessionLogEntries([{ ...envelope, sessionId: '', event: 'user', content: 'ok' }]),
    ).toThrowError(/sessionId/);
    expect(() =>
      decodeSessionLogEntries([
        {
          ...envelope,
          event: 'history_mutation',
          ...fixtures.history_mutation,
          message: { ...message, timestamp: undefined },
        },
      ]),
    ).toThrowError(/message.timestamp/);
  });

  it('checks the producer-owned context state in both compaction snapshots', () => {
    const before = { maxTokens: 100, usedTokens: 80, usedPercentage: 80, remainingPercentage: 20 };
    const after = { maxTokens: 100, usedTokens: 20, usedPercentage: 20, remainingPercentage: 80 };
    expect(
      decodeSessionLogEntries([
        { ...envelope, event: 'context_compact', trigger: 'auto', before, after },
      ]),
    ).toHaveLength(1);
    for (const [key, value] of [
      ['before', { ...before, usedTokens: '80' }],
      ['after', { ...after, remainingPercentage: undefined }],
    ] as const) {
      expect(() =>
        decodeSessionLogEntries([
          { ...envelope, event: 'context_compact', trigger: 'auto', before, after, [key]: value },
        ]),
      ).toThrowError(new RegExp(`${key}\\.`));
    }
  });

  it('checks every declared owner-path segment field', () => {
    const valid = [
      { type: 'agent', id: 'root-1' },
      { type: 'tool', id: 'tool-1' },
    ];
    expect(
      decodeSessionLogEntries([
        {
          ...envelope,
          event: 'tool_execution_request',
          ...fixtures.tool_execution_request,
          ownerPath: valid,
        },
      ]),
    ).toHaveLength(1);
    for (const ownerPath of [
      [{ type: 'agent' }],
      [{ type: 'agent', id: 1 }],
      [{ type: 'agent', id: 'root-1', secret: true }],
    ]) {
      expect(() =>
        decodeSessionLogEntries([
          {
            ...envelope,
            event: 'tool_execution_request',
            ...fixtures.tool_execution_request,
            ownerPath,
          },
        ]),
      ).toThrowError(/ownerPath\[0\]/);
    }
  });

  it('stops before recursively decoding a cyclic tool schema', () => {
    const parameters: { type: string; properties: Record<string, unknown> } = {
      type: 'object',
      properties: {},
    };
    parameters.properties['again'] = parameters;
    const entry = {
      ...envelope,
      event: 'session_init',
      ...fixtures.session_init,
      toolSchemas: [{ name: 'Cyclic', description: 'test', parameters }],
    };
    expect(() => decodeSessionLogEntries([entry])).toThrow(SessionLogDecodeError);
    try {
      decodeSessionLogEntries([entry]);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionLogDecodeError);
      expect((error as SessionLogDecodeError).issues[0]?.path).toContain(
        'parameters.properties.again',
      );
    }
  });

  it('rejects a class instance as the root event object', () => {
    const entry = Object.assign(new (class SessionLogLike {})(), envelope, {
      event: 'user',
      content: 'hello',
    });
    expect(() => decodeSessionLogEntries([entry])).toThrow(SessionLogDecodeError);
  });

  it('locates a nested JSONL defect at the physical line', () => {
    const source = {
      readText: () =>
        `\n${JSON.stringify({ ...envelope, event: 'user', content: 'ok' })}\n\n${JSON.stringify({ ...envelope, event: 'text_delta', delta: 2 })}\n`,
      externalPayloadSource: undefined,
    };
    expect(() => loadSessionLogEntries(source)).toThrow(SessionLogDecodeError);
    try {
      loadSessionLogEntries(source);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_EVENT',
        issues: [{ path: 'line 4.delta', message: expect.any(String) }],
      });
    }
  });

  it('rejects malformed history instead of silently dropping its role', () => {
    const entries = [
      { ...envelope, event: 'user', content: 'hello' },
      {
        ...envelope,
        event: 'history_mutation',
        mutation: 'append_message',
        index: 0,
        message: {
          id: 'm1',
          role: 'bogus',
          content: 'secret',
          state: 'complete',
          timestamp: envelope.timestamp,
        },
      },
    ];
    expect(() => replaySessionLogEntries(entries)).toThrow(SessionLogDecodeError);
    try {
      decodeSessionLogEntries(entries);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_EVENT',
        issues: [{ path: '[1].message.role', message: expect.stringContaining('expected') }],
      });
    }
  });

  it('locates invalid JSON at its physical line, including blanks', () => {
    const source = {
      readText: () => '\n{"schemaVersion":1,"event":\n',
      externalPayloadSource: undefined,
    };
    expect(() => loadSessionLogEntries(source)).toThrow(SessionLogDecodeError);
    try {
      loadSessionLogEntries(source);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_JSON',
        issues: [{ path: 'line 2', message: expect.any(String) }],
      });
      expect((error as Error).cause).toBeInstanceOf(SyntaxError);
    }
  });
});
