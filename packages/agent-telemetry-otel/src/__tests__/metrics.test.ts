import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it } from 'vitest';

import {
  GEN_AI_AGENT_DURATION_BUCKETS_S,
  GEN_AI_CALL_COUNT_BUCKETS,
  GEN_AI_DURATION_BUCKETS_S,
  GEN_AI_TOKEN_BUCKETS,
  projectLivePromptMetricSamples,
} from '../index.js';
import type { IOtelMetricSample } from '../index.js';

const TRACE = '0123456789abcdef0123456789abcdef';
const ROOT = '1111111111111111';

type TChild = ILivePromptTraceBatch['children'][number];
type TProviderTrace = Extract<TChild, { kind: 'provider' }>['trace'];

function provider(overrides: Partial<TProviderTrace> = {}): TChild {
  return {
    kind: 'provider',
    trace: {
      traceId: TRACE, parentSpanId: ROOT, spanId: '2222222222222222', outcome: 'success', round: 1,
      startedAt: '2026-10-17T00:00:00.100Z', endedAt: '2026-10-17T00:00:01.300Z',
      disposition: 'invoked', providerId: 'anthropic', modelId: 'claude-sonnet-4-5',
      usageProvenance: 'complete', promptTokens: 120, completionTokens: 30, totalTokens: 150,
      ...overrides,
    },
  };
}

function tool(overrides: Partial<Extract<TChild, { kind: 'tool' }>['trace']> = {}): TChild {
  return {
    kind: 'tool',
    trace: {
      traceId: TRACE, parentSpanId: ROOT, spanId: '3333333333333333', outcome: 'failure',
      startedAt: '2026-10-17T00:00:01.500Z', endedAt: '2026-10-17T00:00:01.800Z',
      toolCallId: 'toolu_01', toolName: 'Read', ...overrides,
    },
  };
}

function batch(children: TChild[], overrides: Partial<ILivePromptTraceBatch> = {}): ILivePromptTraceBatch {
  return {
    schemaVersion: 1, sessionId: 'session-1', turnId: 'turn-1',
    root: {
      traceId: TRACE, spanId: ROOT, outcome: 'failure',
      startedAt: '2026-10-17T00:00:00.000Z', endedAt: '2026-10-17T00:00:03.000Z',
    },
    children,
    omittedChildren: { provider: 0, tool: 0, permission: 0 },
    ...overrides,
  };
}

const names = (samples: IOtelMetricSample[]): string[] => samples.map((sample) => sample.name);
const only = (samples: IOtelMetricSample[], name: string): IOtelMetricSample[] =>
  samples.filter((sample) => sample.name === name);

describe('projectLivePromptMetricSamples', () => {
  it('projects every GenAI measurement for a rich batch', () => {
    const permission: TChild = {
      kind: 'permission',
      decision: { traceId: TRACE, parentSpanId: ROOT, decidedAt: '2026-10-17T00:00:01.400Z', decision: 'allowed' },
    };
    const samples = projectLivePromptMetricSamples(batch([
      provider(),
      permission,
      tool(),
      provider({ outcome: 'failure', providerId: 'my-gateway', modelId: undefined, usageProvenance: 'partial',
        promptTokens: undefined, completionTokens: undefined, totalTokens: undefined,
        startedAt: '2026-10-17T00:00:01.900Z', endedAt: '2026-10-17T00:00:02.500Z' }),
    ]), { agentName: 'robota' });

    const ok = { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'anthropic', 'gen_ai.request.model': 'claude-sonnet-4-5' };
    const failed = { 'gen_ai.operation.name': 'chat', 'error.type': '_OTHER' };
    expect(samples).toEqual([
      { name: 'gen_ai.client.inference.duration', instrument: 'histogram', unit: 's', value: 1.2, attributes: ok, boundaries: GEN_AI_DURATION_BUCKETS_S },
      { name: 'gen_ai.client.inference.usage.input_tokens', instrument: 'counter', unit: '{token}', value: 120, attributes: { ...ok, 'gen_ai.token.modality': 'unknown' } },
      { name: 'gen_ai.client.inference.usage.output_tokens', instrument: 'counter', unit: '{token}', value: 30, attributes: { ...ok, 'gen_ai.token.modality': 'unknown' } },
      { name: 'gen_ai.client.inference.operation.input_tokens', instrument: 'histogram', unit: '{token}', value: 120, attributes: ok, boundaries: GEN_AI_TOKEN_BUCKETS },
      { name: 'gen_ai.client.inference.operation.output_tokens', instrument: 'histogram', unit: '{token}', value: 30, attributes: ok, boundaries: GEN_AI_TOKEN_BUCKETS },
      { name: 'gen_ai.client.inference.duration', instrument: 'histogram', unit: 's', value: 0.6, attributes: failed, boundaries: GEN_AI_DURATION_BUCKETS_S },
      { name: 'gen_ai.client.inference.usage.input_tokens', instrument: 'counter', unit: '{token}', value: 0, attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.token.modality': 'unknown' } },
      { name: 'gen_ai.client.inference.usage.output_tokens', instrument: 'counter', unit: '{token}', value: 0, attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.token.modality': 'unknown' } },
      { name: 'gen_ai.client.inference.operation.input_tokens', instrument: 'histogram', unit: '{token}', value: 0, attributes: failed, boundaries: GEN_AI_TOKEN_BUCKETS },
      { name: 'gen_ai.client.inference.operation.output_tokens', instrument: 'histogram', unit: '{token}', value: 0, attributes: failed, boundaries: GEN_AI_TOKEN_BUCKETS },
      { name: 'gen_ai.execute_tool.duration', instrument: 'histogram', unit: 's', value: 0.3,
        attributes: { 'gen_ai.tool.name': 'Read', 'gen_ai.agent.name': 'robota', 'error.type': '_OTHER' }, boundaries: GEN_AI_DURATION_BUCKETS_S },
      { name: 'gen_ai.invoke_agent.duration', instrument: 'histogram', unit: 's', value: 3,
        attributes: { 'gen_ai.agent.name': 'robota', 'error.type': '_OTHER' }, boundaries: GEN_AI_AGENT_DURATION_BUCKETS_S },
      { name: 'gen_ai.invoke_agent.inference_calls', instrument: 'histogram', unit: '{inference_call}', value: 2,
        attributes: { 'gen_ai.agent.name': 'robota' }, boundaries: GEN_AI_CALL_COUNT_BUCKETS },
      { name: 'gen_ai.invoke_agent.tool_calls', instrument: 'histogram', unit: '{tool_call}', value: 1,
        attributes: { 'gen_ai.agent.name': 'robota' }, boundaries: GEN_AI_CALL_COUNT_BUCKETS },
    ]);
  });

  it('pins the recommended bucket boundaries', () => {
    expect(GEN_AI_DURATION_BUCKETS_S).toHaveLength(14);
    expect(GEN_AI_DURATION_BUCKETS_S[0]).toBe(0.01);
    expect(GEN_AI_DURATION_BUCKETS_S.at(-1)).toBe(81.92);
    expect(GEN_AI_AGENT_DURATION_BUCKETS_S).toHaveLength(13);
    expect(GEN_AI_AGENT_DURATION_BUCKETS_S.at(-1)).toBe(409.6);
    expect(GEN_AI_TOKEN_BUCKETS).toHaveLength(14);
    expect(GEN_AI_TOKEN_BUCKETS.at(-1)).toBe(67_108_864);
    expect(GEN_AI_CALL_COUNT_BUCKETS).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
  });

  it('records 0 tokens under the unknown modality unless usage is complete', () => {
    for (const usage of [
      { usageProvenance: 'partial' as const, promptTokens: 7, completionTokens: 3 },
      { usageProvenance: 'absent' as const, promptTokens: undefined, completionTokens: undefined },
      { usageProvenance: undefined, promptTokens: 7, completionTokens: 3 },
      { usageProvenance: 'complete' as const, promptTokens: 7, completionTokens: undefined },
      { usageProvenance: 'complete' as const, promptTokens: -1, completionTokens: 3 },
      { usageProvenance: 'complete' as const, promptTokens: 1.5, completionTokens: 3 },
      { usageProvenance: 'complete' as const, promptTokens: Number.MAX_SAFE_INTEGER + 1, completionTokens: 3 },
    ]) {
      const samples = projectLivePromptMetricSamples(batch([provider({ ...usage, totalTokens: undefined })]), {});
      const tokens = samples.filter((sample) => sample.name.includes('tokens'));
      expect(tokens).toHaveLength(4);
      expect(tokens.map((sample) => sample.value)).toEqual([0, 0, 0, 0]);
      for (const counter of tokens.filter((sample) => sample.instrument === 'counter')) {
        expect(counter.attributes).toMatchObject({ 'gen_ai.token.modality': 'unknown' });
      }
    }
  });

  it('keeps error.type off the token counters and the success path', () => {
    const failed = projectLivePromptMetricSamples(batch([provider({ outcome: 'failure' })]), {});
    for (const sample of failed.filter((item) => item.name.startsWith('gen_ai.client.'))) {
      const hasError = 'error.type' in sample.attributes;
      expect(hasError).toBe(!sample.name.includes('.usage.'));
    }
    const interrupted = projectLivePromptMetricSamples(batch([provider({ outcome: 'interrupted' })]), {});
    expect(interrupted.some((item) => 'error.type' in item.attributes && item.name.startsWith('gen_ai.client.'))).toBe(false);
  });

  it('emits no provider-derived sample when provider children were omitted', () => {
    const samples = projectLivePromptMetricSamples(
      batch([provider(), tool()], { omittedChildren: { provider: 1, tool: 0, permission: 0 } }), { agentName: 'robota' });
    expect(names(samples)).toEqual([
      'gen_ai.execute_tool.duration', 'gen_ai.invoke_agent.duration', 'gen_ai.invoke_agent.tool_calls',
    ]);
  });

  it('emits no tool-derived sample when tool children were omitted', () => {
    const samples = projectLivePromptMetricSamples(
      batch([provider(), tool()], { omittedChildren: { provider: 0, tool: 2, permission: 0 } }), { agentName: 'robota' });
    expect(names(samples)).not.toContain('gen_ai.execute_tool.duration');
    expect(names(samples)).not.toContain('gen_ai.invoke_agent.tool_calls');
    expect(names(samples)).toContain('gen_ai.invoke_agent.inference_calls');
    expect(names(samples)).toContain('gen_ai.client.inference.duration');
  });

  it('keeps the root duration when children were omitted, and counts nothing it cannot prove', () => {
    const samples = projectLivePromptMetricSamples(
      batch([], { omittedChildren: { provider: 3, tool: 3, permission: 0 } }), {});
    expect(names(samples)).toEqual(['gen_ai.invoke_agent.duration']);
  });

  it('excludes cache hits and refused calls from every inference measurement', () => {
    const samples = projectLivePromptMetricSamples(batch([
      provider({ disposition: 'cache-hit' }),
      provider({ disposition: 'preflight-refused', outcome: 'failure' }),
      provider({ disposition: undefined }),
      provider(),
    ]), {});
    expect(only(samples, 'gen_ai.client.inference.duration')).toHaveLength(1);
    expect(only(samples, 'gen_ai.invoke_agent.inference_calls')[0]!.value).toBe(1);
  });

  it('records zero calls for a prompt without provider or tool children', () => {
    const samples = projectLivePromptMetricSamples(batch([]), {});
    expect(only(samples, 'gen_ai.invoke_agent.inference_calls')[0]!.value).toBe(0);
    expect(only(samples, 'gen_ai.invoke_agent.tool_calls')[0]!.value).toBe(0);
  });

  it('drops a model, tool name or provider that is not safe to label', () => {
    const samples = projectLivePromptMetricSamples(batch([
      provider({ modelId: 'private prompt text', providerId: 'constructor' }),
      tool({ toolName: 'private tool output' }),
    ]), { agentName: 'robota' });
    const chat = only(samples, 'gen_ai.client.inference.duration')[0]!;
    expect(chat.attributes).toEqual({ 'gen_ai.operation.name': 'chat' });
    expect(only(samples, 'gen_ai.execute_tool.duration')[0]!.attributes)
      .toEqual({ 'gen_ai.agent.name': 'robota', 'error.type': '_OTHER' });
    expect(JSON.stringify(samples)).not.toMatch(/private/u);
  });

  it('names a Gemini or Google provider with the convention name for any Google endpoint', () => {
    const [gemini, google] = ['gemini', 'google'].map((providerId) =>
      only(projectLivePromptMetricSamples(batch([provider({ providerId })]), {}), 'gen_ai.client.inference.duration')[0]!);
    expect(gemini!.attributes).toMatchObject({ 'gen_ai.provider.name': 'gcp.gen_ai' });
    expect(google!.attributes).toMatchObject({ 'gen_ai.provider.name': 'gcp.gen_ai' });
  });

  it('omits the agent name when the host gives none and drops unmeasurable durations', () => {
    const samples = projectLivePromptMetricSamples(batch([
      tool({ startedAt: 'not a time' }),
      provider({ endedAt: '2026-10-16T00:00:00.000Z' }),
    ], { root: { traceId: TRACE, spanId: ROOT, outcome: 'success', startedAt: '2026-10-17T00:00:03.000Z', endedAt: '2026-10-17T00:00:00.000Z' } }), {});
    expect(names(samples)).not.toContain('gen_ai.execute_tool.duration');
    expect(names(samples)).not.toContain('gen_ai.client.inference.duration');
    expect(names(samples)).not.toContain('gen_ai.invoke_agent.duration');
    expect(only(samples, 'gen_ai.invoke_agent.tool_calls')[0]!.attributes).toEqual({});
  });

  it('is pure: the same batch and options project to equal samples', () => {
    const input = batch([provider(), tool()]);
    expect(projectLivePromptMetricSamples(input, { agentName: 'robota' }))
      .toEqual(projectLivePromptMetricSamples(input, { agentName: 'robota' }));
  });
});
