import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it } from 'vitest';

import { GEN_AI_SCHEMA_URL, projectLivePromptTrace } from '../index.js';

const TRACE = '0123456789abcdef0123456789abcdef';
const ROOT = '1111111111111111';
const PROVIDER = '2222222222222222';
const TOOL = '3333333333333333';

function batch(overrides: Partial<ILivePromptTraceBatch> = {}): ILivePromptTraceBatch {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    turnId: 'turn-1',
    root: {
      traceId: TRACE, spanId: ROOT, outcome: 'failure',
      startedAt: '2026-10-17T00:00:00.000Z', endedAt: '2026-10-17T00:00:03.000Z',
    },
    timingTotals: {
      provider: { durationMs: 1200, samples: 1, invalid: 0 },
      tool: { durationMs: 300, samples: 1, invalid: 0 },
      queue: { durationMs: 5, samples: 1, invalid: 0, admissionStarted: 1, notDispatched: 0 },
    },
    children: [
      {
        kind: 'provider',
        trace: {
          traceId: TRACE, parentSpanId: ROOT, spanId: PROVIDER, outcome: 'success', round: 1,
          startedAt: '2026-10-17T00:00:00.100Z', endedAt: '2026-10-17T00:00:01.300Z',
          disposition: 'invoked', providerId: 'anthropic', modelId: 'claude-sonnet-4-5',
          usageProvenance: 'complete', promptTokens: 120, completionTokens: 30, totalTokens: 150,
          providerRequestId: 'req_01',
        },
      },
      {
        kind: 'permission',
        decision: { traceId: TRACE, parentSpanId: ROOT, decidedAt: '2026-10-17T00:00:01.400Z', decision: 'allowed' },
      },
      {
        kind: 'tool',
        trace: {
          traceId: TRACE, parentSpanId: ROOT, spanId: TOOL, outcome: 'failure',
          startedAt: '2026-10-17T00:00:01.500Z', endedAt: '2026-10-17T00:00:01.800Z',
          toolCallId: 'toolu_01', toolName: 'Read',
        },
      },
    ],
    omittedChildren: { provider: 0, tool: 1, permission: 2 },
    ...overrides,
  };
}

const ROOT_TIMING = {
  'agent.timing.provider.duration_ms': 1200,
  'agent.timing.provider.samples': 1,
  'agent.timing.provider.invalid': 0,
  'agent.timing.tool.duration_ms': 300,
  'agent.timing.tool.samples': 1,
  'agent.timing.tool.invalid': 0,
  'agent.timing.queue.duration_ms': 5,
  'agent.timing.queue.samples': 1,
  'agent.timing.queue.invalid': 0,
  'agent.timing.queue.admission_started': 1,
  'agent.timing.queue.not_dispatched': 0,
};
const ROOT_SHARED = {
  'agent.turn.id': 'turn-1',
  'agent.outcome': 'failure',
  'agent.omitted.provider_count': 0,
  'agent.omitted.tool_count': 1,
  'agent.omitted.permission_count': 2,
  ...ROOT_TIMING,
};
const PROVIDER_SHARED = {
  'agent.outcome': 'success',
  'agent.provider.round': 1,
  'agent.provider.disposition': 'invoked',
  'agent.provider.id': 'anthropic',
  'agent.usage.provenance': 'complete',
  'agent.usage.total_tokens': 150,
  'agent.provider.request_id': 'req_01',
};
const PROVIDER_AGENT = {
  'agent.model.id': 'claude-sonnet-4-5',
  'agent.usage.input_tokens': 120,
  'agent.usage.output_tokens': 30,
};
const PROVIDER_GEN_AI = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': 'anthropic',
  'gen_ai.request.model': 'claude-sonnet-4-5',
  'gen_ai.usage.input_tokens': 120,
  'gen_ai.usage.output_tokens': 30,
};
const TOOL_GEN_AI = {
  'gen_ai.operation.name': 'execute_tool',
  'gen_ai.tool.name': 'Read',
  'gen_ai.tool.call.id': 'toolu_01',
};

describe('projectLivePromptTrace', () => {
  it('reproduces the CLI agent.* spans in agent mode, skipping permission decisions', () => {
    expect(projectLivePromptTrace(batch(), { mode: 'agent' })).toEqual({
      root: {
        name: 'agent.prompt_execution', kind: 'internal', traceId: TRACE, spanId: ROOT, status: 'error',
        startedAt: '2026-10-17T00:00:00.000Z', endedAt: '2026-10-17T00:00:03.000Z',
        attributes: { 'agent.session.id': 'session-1', ...ROOT_SHARED },
      },
      children: [
        {
          name: 'agent.provider_call', kind: 'internal', traceId: TRACE, spanId: PROVIDER, parentSpanId: ROOT,
          status: 'unset', startedAt: '2026-10-17T00:00:00.100Z', endedAt: '2026-10-17T00:00:01.300Z',
          attributes: { ...PROVIDER_SHARED, ...PROVIDER_AGENT },
        },
        {
          name: 'agent.tool_body', kind: 'internal', traceId: TRACE, spanId: TOOL, parentSpanId: ROOT,
          status: 'error', startedAt: '2026-10-17T00:00:01.500Z', endedAt: '2026-10-17T00:00:01.800Z',
          attributes: { 'agent.outcome': 'failure', 'agent.tool.call_id': 'toolu_01' },
        },
      ],
    });
  });

  it('keeps the CLI attribute order and no error.type in agent mode', () => {
    const projection = projectLivePromptTrace(batch(), { mode: 'agent' });
    expect(Object.keys(projection.children[0]?.attributes ?? {})).toEqual([
      'agent.outcome', 'agent.provider.round', 'agent.provider.disposition', 'agent.provider.id', 'agent.model.id',
      'agent.usage.provenance', 'agent.usage.input_tokens', 'agent.usage.output_tokens', 'agent.usage.total_tokens',
      'agent.provider.request_id',
    ]);
    expect(Object.keys(projection.root.attributes).slice(0, 3)).toEqual([
      'agent.session.id', 'agent.turn.id', 'agent.outcome',
    ]);
    expect(projection.root.attributes).not.toHaveProperty('error.type');
  });

  it('puts every child in the root trace, as children of the root', () => {
    const base = batch();
    const projection = projectLivePromptTrace(batch({
      children: [{
        kind: 'tool',
        trace: { ...(base.children[2] as { trace: object }).trace, traceId: 'f'.repeat(32), parentSpanId: '4'.repeat(16) } as never,
      }],
    }), { mode: 'agent' });
    expect(projection.children[0]).toMatchObject({ traceId: TRACE, parentSpanId: ROOT });
  });

  it('uses GenAI span names, kinds and attributes in gen_ai mode, keeping Robota-only facts as agent.*', () => {
    const projection = projectLivePromptTrace(batch(), { mode: 'gen_ai', agentName: 'robota' });
    expect(projection.schemaUrl).toBe(GEN_AI_SCHEMA_URL);
    expect(projection.root).toMatchObject({ name: 'invoke_agent robota', kind: 'internal' });
    expect(projection.root.attributes).toEqual({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': 'robota',
      'gen_ai.conversation.id': 'session-1',
      ...ROOT_SHARED,
      'error.type': '_OTHER',
    });
    const [provider, tool] = projection.children;
    expect(provider).toMatchObject({ name: 'chat claude-sonnet-4-5', kind: 'client', parentSpanId: ROOT });
    expect(provider?.attributes).toEqual({ ...PROVIDER_GEN_AI, ...PROVIDER_SHARED });
    expect(tool).toMatchObject({ name: 'execute_tool Read', kind: 'internal', status: 'error' });
    expect(tool?.attributes).toEqual({ ...TOOL_GEN_AI, 'agent.outcome': 'failure', 'error.type': '_OTHER' });
  });

  it('emits both attribute sets under GenAI names in gen_ai/dup mode', () => {
    const projection = projectLivePromptTrace(batch(), { mode: 'gen_ai/dup', agentName: 'robota' });
    expect(projection.schemaUrl).toBe(GEN_AI_SCHEMA_URL);
    expect(projection.root.name).toBe('invoke_agent robota');
    expect(projection.root.attributes).toEqual({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': 'robota',
      'gen_ai.conversation.id': 'session-1',
      'agent.session.id': 'session-1',
      ...ROOT_SHARED,
      'error.type': '_OTHER',
    });
    const [provider, tool] = projection.children;
    expect(provider?.kind).toBe('client');
    expect(provider?.attributes).toEqual({ ...PROVIDER_GEN_AI, ...PROVIDER_SHARED, ...PROVIDER_AGENT });
    expect(tool?.attributes).toEqual({
      ...TOOL_GEN_AI, 'agent.outcome': 'failure', 'agent.tool.call_id': 'toolu_01', 'error.type': '_OTHER',
    });
  });

  it('falls back to bare operation names when the agent, model or tool name is unknown', () => {
    const base = batch();
    const projection = projectLivePromptTrace(batch({
      children: [
        { kind: 'provider', trace: { ...(base.children[0] as { trace: object }).trace, modelId: undefined } as never },
        { kind: 'tool', trace: { ...(base.children[2] as { trace: object }).trace, toolName: 'bad name\n' } as never },
      ],
    }), { mode: 'gen_ai' });
    expect(projection.root.name).toBe('invoke_agent');
    expect(projection.root.attributes).not.toHaveProperty('gen_ai.agent.name');
    expect(projection.children.map((child) => child.name)).toEqual(['chat', 'execute_tool']);
    expect(projection.children[0]?.attributes).not.toHaveProperty('gen_ai.request.model');
    expect(projection.children[1]?.attributes).not.toHaveProperty('gen_ai.tool.name');
  });

  it.each([
    ['anthropic', 'anthropic'],
    ['openai', 'openai'],
    ['deepseek', 'deepseek'],
    ['gemini', 'gcp.gen_ai'],
    ['google', 'gcp.gen_ai'],
    ['qwen', undefined],
    ['my-gateway', undefined],
  ])('names provider %s as GenAI provider %s', (providerId, expected) => {
    const base = batch();
    const projection = projectLivePromptTrace(batch({
      children: [{ kind: 'provider', trace: { ...(base.children[0] as { trace: object }).trace, providerId } as never }],
    }), { mode: 'gen_ai' });
    expect(projection.children[0]?.attributes['gen_ai.provider.name']).toBe(expected);
    expect(projection.children[0]?.attributes['agent.provider.id']).toBe(providerId);
  });

  it('omits token counts unless usage is complete, and drops IDs outside the opaque-ID shape', () => {
    const base = batch();
    const projection = projectLivePromptTrace(batch({
      children: [
        {
          kind: 'provider',
          trace: {
            ...(base.children[0] as { trace: object }).trace,
            usageProvenance: 'partial', providerRequestId: 'req 01\nsecret',
          } as never,
        },
        { kind: 'tool', trace: { ...(base.children[2] as { trace: object }).trace, toolCallId: 'x'.repeat(129) } as never },
      ],
    }), { mode: 'gen_ai/dup' });
    const [provider, tool] = projection.children;
    expect(Object.keys(provider?.attributes ?? {}).filter((key) => key.includes('tokens'))).toEqual([]);
    expect(provider?.attributes).not.toHaveProperty('agent.provider.request_id');
    expect(tool?.attributes).not.toHaveProperty('agent.tool.call_id');
    expect(tool?.attributes).not.toHaveProperty('gen_ai.tool.call.id');
  });

  it('drops malformed timing totals and treats an interrupted outcome as no error', () => {
    const projection = projectLivePromptTrace(batch({
      root: { ...batch().root, outcome: 'interrupted' },
      timingTotals: { provider: { durationMs: 5, samples: 0, invalid: 0 }, tool: { durationMs: -1, samples: 1, invalid: 0 } },
      children: [],
    }), { mode: 'agent' });
    expect(projection.root.status).toBe('unset');
    expect(Object.keys(projection.root.attributes).filter((key) => key.startsWith('agent.timing.'))).toEqual([]);
    expect(projection.children).toEqual([]);
    expect(projection).not.toHaveProperty('schemaUrl');
  });
});
