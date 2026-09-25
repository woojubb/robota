import { describe, expect, it } from 'vitest';

import { createOtlpPromptEvents } from '../otlp-prompt-events.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const TRACE_ID = '1234567890abcdef1234567890abcdef';
const ROOT_ID = '1234567890abcdef';
const NOW = new Date('2026-09-24T00:05:00.000Z');

function record(): IInteractiveSessionRecord {
  return {
    id: 'private-session',
    cwd: '/secret/workspace',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:01:00.000Z',
    messages: [],
    history: [
      {
        id: 'root',
        timestamp: new Date('2026-09-24T00:01:00.000Z'),
        category: 'event',
        type: 'usage-observation',
        data: {
          usageObservationId: 'turn-private',
          turnId: 'turn-private',
          outcome: 'failure',
          promptExecutionStartedAt: '2026-09-24T00:00:59.000Z',
          promptExecutionEndedAt: '2026-09-24T00:01:00.000Z',
          promptExecutionOutcome: 'success',
          promptExecutionTraceId: TRACE_ID,
          promptExecutionSpanId: ROOT_ID,
          prompt: 'secret prompt',
        },
      },
      {
        id: 'provider',
        timestamp: new Date('2026-09-24T00:00:59.900Z'),
        category: 'event',
        type: 'provider-call-trace',
        data: {
          traceId: TRACE_ID,
          parentSpanId: ROOT_ID,
          spanId: 'abcdef1234567890',
          startedAt: '2026-09-24T00:00:59.100Z',
          endedAt: '2026-09-24T00:00:59.900Z',
          outcome: 'failure',
          round: 1,
          disposition: 'invoked', usageProvenance: 'complete', modelId: 'gpt-4o',
          promptTokens: 100, completionTokens: 50, totalTokens: 150,
          response: 'secret response',
        },
      },
      {
        id: 'tool',
        timestamp: new Date('2026-09-24T00:00:59.800Z'),
        category: 'event',
        type: 'tool-body-trace',
        data: {
          traceId: TRACE_ID,
          parentSpanId: ROOT_ID,
          spanId: 'fedcba0987654321',
          startedAt: '2026-09-24T00:00:59.200Z',
          endedAt: '2026-09-24T00:00:59.800Z',
          outcome: 'interrupted',
          toolResult: 'secret tool output',
        },
      },
    ],
  };
}

describe('content-free OTLP completion events', () => {
  it('exports only verified root and child completions with actual end and export observation times', () => {
    const result = createOtlpPromptEvents([record()], 'test-version', NOW);
    const logRecords = result.payload.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [];
    expect(result.exported).toBe(3);
    expect(logRecords.map((log) => log.eventName)).toEqual([
      'robota.prompt_execution.completed',
      'robota.provider_call.completed',
      'robota.tool_body.completed',
    ]);
    expect(logRecords.map((log) => log.severityNumber)).toEqual([9, 17, 13]);
    expect(logRecords[0]).toMatchObject({
      traceId: TRACE_ID,
      spanId: ROOT_ID,
      timeUnixNano: '1790208060000000000',
      observedTimeUnixNano: '1790208300000000000',
      attributes: [{ key: 'robota.prompt.outcome', value: { stringValue: 'success' } }],
    });
    expect(logRecords[1]?.attributes).toEqual([{ key: 'robota.provider.outcome', value: { stringValue: 'failure' } }]);
    expect(JSON.stringify(result.payload)).not.toMatch(
      /secret|private|turn-private|response|toolResult|prompt:/,
    );
  });

  it('does not make events from missing roots, malformed children or duplicate child identities', () => {
    const session = record();
    const root = session.history![0]!.data as Record<string, unknown>;
    delete root['promptExecutionSpanId'];
    expect(createOtlpPromptEvents([session], 'test-version', NOW).exported).toBe(0);

    root['promptExecutionSpanId'] = ROOT_ID;
    session.history!.push({
      ...session.history![2]!,
      id: 'duplicate-tool',
      data: { ...(session.history![2]!.data as object), endedAt: 'bad' },
    });
    const result = createOtlpPromptEvents([session], 'test-version', NOW);
    expect(result.exported).toBe(2);
    expect(result.coverage.toolChildren.duplicate).toBe(2);
  });

  it('rejects an invalid or unsigned-fixed64-overflow export observation time', () => {
    expect(() => createOtlpPromptEvents([record()], 'test-version', new Date('bad'))).toThrow(
      /observation time/,
    );
    expect(() =>
      createOtlpPromptEvents([record()], 'test-version', new Date('9999-01-01T00:00:00.000Z')),
    ).toThrow(/out of range/);
  });
});
