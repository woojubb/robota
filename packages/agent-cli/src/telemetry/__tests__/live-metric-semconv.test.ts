import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { JsonMetricsSerializer, ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import {
  GEN_AI_SCHEMA_URL,
  GEN_AI_AGENT_DURATION_BUCKETS_S, GEN_AI_CALL_COUNT_BUCKETS, GEN_AI_DURATION_BUCKETS_S, GEN_AI_TOKEN_BUCKETS,
} from '@robota-sdk/agent-telemetry-otel';
import { describe, expect, it } from 'vitest';
import { createNodeLiveConsolePort } from '../live-console.js';
import { createNodeOtlpLiveMetricPort, projectLivePromptMetrics } from '../live-metric-otlp.js';
import type { ILiveMetricNaming, TLiveMetricAttribute } from '../live-metric-otlp.js';
import { completeBatch, FIXED_RESOURCE, FIXED_WINDOW, richBatch } from './semconv-fixture-shared.js';

const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/agent-mode-metric-export.json', import.meta.url), 'utf8')) as
  Record<'default' | 'allAttributes' | 'completeDefault' | 'completeAllAttributes', string>;
const ALL = new Set<TLiveMetricAttribute>(['session', 'provider', 'model']);
const GEN_AI: ILiveMetricNaming = { semconv: 'gen_ai', agentName: 'robota' };
const DUP: ILiveMetricNaming = { semconv: 'gen_ai/dup', agentName: 'robota' };

const project = (batch: ILivePromptTraceBatch, attributes: ReadonlySet<TLiveMetricAttribute>, naming?: ILiveMetricNaming): ResourceMetrics =>
  projectLivePromptMetrics(batch, FIXED_WINDOW, attributes, naming);
const bytes = (resourceMetrics: ResourceMetrics): string =>
  Buffer.from(ProtobufMetricsSerializer.serializeRequest(resourceMetrics)!).toString('base64');
const metricsOf = (batch: ILivePromptTraceBatch, naming?: ILiveMetricNaming, attributes: ReadonlySet<TLiveMetricAttribute> = new Set()) =>
  project(batch, attributes, naming).scopeMetrics.flatMap((scope) => scope.metrics);
const namesOf = (batch: ILivePromptTraceBatch, naming?: ILiveMetricNaming): string[] =>
  metricsOf(batch, naming).map((metric) => metric.descriptor.name);

interface IWireMetric {
  name: string; unit: string;
  sum?: { aggregationTemporality: number; isMonotonic: boolean; dataPoints: Array<{ asInt?: number; attributes: unknown[] }> };
  histogram?: {
    aggregationTemporality: number;
    dataPoints: Array<{ bucketCounts: number[]; explicitBounds: number[]; count: number; sum: number; min: number; max: number; attributes: unknown[] }>;
  };
}
/** The metrics as the OTLP JSON mapping carries them: what a collector decodes from the wire shape. */
function wire(resourceMetrics: ResourceMetrics): IWireMetric[] {
  const json = JSON.parse(Buffer.from(JsonMetricsSerializer.serializeRequest(resourceMetrics)!).toString('utf8')) as
    { resourceMetrics: Array<{ scopeMetrics: Array<{ metrics: IWireMetric[] }> }> };
  return json.resourceMetrics[0]!.scopeMetrics.flatMap((scope) => scope.metrics);
}
const attributeMap = (attributes: unknown[]): Record<string, string> => Object.fromEntries(
  (attributes as Array<{ key: string; value: { stringValue: string } }>).map(({ key, value }) => [key, value.stringValue]));

describe('live metric semantic-convention modes', () => {
  it('puts the GenAI metrics in their own scope naming the GenAI schema, and only under the opt-in', () => {
    const scopes = (naming?: ILiveMetricNaming) => project(completeBatch(), new Set(), naming).scopeMetrics
      .map(({ scope, metrics }) => [scope.schemaUrl, metrics.some((metric) => metric.descriptor.name.startsWith('gen_ai.'))]);
    expect(scopes()).toEqual([[undefined, false]]);
    expect(scopes(GEN_AI)).toEqual([[undefined, false], [GEN_AI_SCHEMA_URL, true]]);
    expect(scopes(DUP)).toEqual([[undefined, false], [GEN_AI_SCHEMA_URL, true]]);
  });

  it('exports byte-identical metrics in the default agent mode', () => {
    for (const naming of [undefined, { semconv: 'agent' as const }, { semconv: 'agent' as const, agentName: 'robota' }]) {
      expect(bytes(project(richBatch(), new Set(), naming))).toBe(fixture.default);
      expect(bytes(project(richBatch(), ALL, naming))).toBe(fixture.allAttributes);
      expect(bytes(project(completeBatch(), new Set(), naming))).toBe(fixture.completeDefault);
      expect(bytes(project(completeBatch(), ALL, naming))).toBe(fixture.completeAllAttributes);
    }
  });

  it('adds no gen_ai metric in agent mode', () => {
    expect(namesOf(completeBatch()).filter((name) => name.startsWith('gen_ai.'))).toEqual([]);
  });

  it('exports the GenAI instruments, units, boundaries and counts in gen_ai mode', () => {
    const metrics = wire(project(completeBatch(), new Set(), GEN_AI));
    const byName = new Map(metrics.map((metric) => [metric.name, metric]));
    expect(metrics.map((metric) => metric.name).filter((name) => name.startsWith('gen_ai.'))).toEqual([
      'gen_ai.client.inference.duration',
      'gen_ai.client.inference.usage.input_tokens',
      'gen_ai.client.inference.usage.output_tokens',
      'gen_ai.client.inference.operation.input_tokens',
      'gen_ai.client.inference.operation.output_tokens',
      'gen_ai.execute_tool.duration',
      'gen_ai.invoke_agent.duration',
      'gen_ai.invoke_agent.inference_calls',
      'gen_ai.invoke_agent.tool_calls',
    ]);
    const DELTA = 1;
    const bucket = (boundaries: readonly number[], value: number): number[] => {
      const counts = new Array<number>(boundaries.length + 1).fill(0);
      counts[boundaries.findIndex((bound) => value <= bound)] = 1;
      return counts;
    };
    const histogram = (name: string, unit: string, boundaries: readonly number[], values: number[]) => {
      const metric = byName.get(name)!;
      expect(metric.unit).toBe(unit);
      expect(metric.sum).toBeUndefined();
      expect(metric.histogram!.aggregationTemporality).toBe(DELTA);
      expect(metric.histogram!.dataPoints.map((point) => point.explicitBounds)).toEqual(values.map(() => [...boundaries]));
      expect(metric.histogram!.dataPoints.map((point) => point.bucketCounts)).toEqual(values.map((value) => bucket(boundaries, value)));
      expect(metric.histogram!.dataPoints.map(({ count, sum, min, max }) => [count, sum, min, max]))
        .toEqual(values.map((value) => [1, value, value, value]));
    };
    // Provider calls: 1.2 s answered with 120/30 tokens, then 0.6 s with no complete usage.
    histogram('gen_ai.client.inference.duration', 's', GEN_AI_DURATION_BUCKETS_S, [1.2, 0.6]);
    histogram('gen_ai.client.inference.operation.input_tokens', '{token}', GEN_AI_TOKEN_BUCKETS, [120, 0]);
    histogram('gen_ai.client.inference.operation.output_tokens', '{token}', GEN_AI_TOKEN_BUCKETS, [30, 0]);
    histogram('gen_ai.execute_tool.duration', 's', GEN_AI_DURATION_BUCKETS_S, [0.3]);
    histogram('gen_ai.invoke_agent.duration', 's', GEN_AI_AGENT_DURATION_BUCKETS_S, [3]);
    histogram('gen_ai.invoke_agent.inference_calls', '{inference_call}', GEN_AI_CALL_COUNT_BUCKETS, [2]);
    histogram('gen_ai.invoke_agent.tool_calls', '{tool_call}', GEN_AI_CALL_COUNT_BUCKETS, [1]);
    for (const name of ['gen_ai.client.inference.usage.input_tokens', 'gen_ai.client.inference.usage.output_tokens']) {
      const counter = byName.get(name)!;
      expect(counter.unit).toBe('{token}');
      expect(counter.histogram).toBeUndefined();
      expect(counter.sum).toMatchObject({ aggregationTemporality: DELTA, isMonotonic: true });
    }
    expect(byName.get('gen_ai.client.inference.usage.input_tokens')!.sum!.dataPoints.map((point) => Number(point.asInt))).toEqual([120, 0]);
    expect(byName.get('gen_ai.client.inference.usage.output_tokens')!.sum!.dataPoints.map((point) => Number(point.asInt))).toEqual([30, 0]);
  });

  it('labels each GenAI point with the request model, the unknown token modality and a failure type', () => {
    const metrics = new Map(wire(project(completeBatch(), new Set(), GEN_AI)).map((metric) => [metric.name, metric]));
    const chat = { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'anthropic', 'gen_ai.request.model': 'claude-sonnet-4-5' };
    const unknownProvider = { 'gen_ai.operation.name': 'chat' };
    expect(metrics.get('gen_ai.client.inference.duration')!.histogram!.dataPoints.map((point) => attributeMap(point.attributes)))
      .toEqual([chat, unknownProvider]);
    expect(metrics.get('gen_ai.client.inference.usage.input_tokens')!.sum!.dataPoints.map((point) => attributeMap(point.attributes)))
      .toEqual([{ ...chat, 'gen_ai.token.modality': 'unknown' }, { ...unknownProvider, 'gen_ai.token.modality': 'unknown' }]);
    expect(metrics.get('gen_ai.execute_tool.duration')!.histogram!.dataPoints.map((point) => attributeMap(point.attributes)))
      .toEqual([{ 'gen_ai.tool.name': 'Read', 'gen_ai.agent.name': 'robota', 'error.type': '_OTHER' }]);
    expect(metrics.get('gen_ai.invoke_agent.duration')!.histogram!.dataPoints.map((point) => attributeMap(point.attributes)))
      .toEqual([{ 'gen_ai.agent.name': 'robota', 'error.type': '_OTHER' }]);
  });

  it('groups equal attribute sets into one data point and keeps different ones apart', () => {
    const at = (start: string, end: string, modelId: string): ILivePromptTraceBatch['children'][number] => ({
      kind: 'provider', trace: {
        traceId: richBatch().root.traceId, parentSpanId: richBatch().root.spanId, spanId: '4444444444444444',
        outcome: 'success', round: 1, startedAt: start, endedAt: end, disposition: 'invoked', providerId: 'anthropic', modelId,
        usageProvenance: 'complete', promptTokens: 100, completionTokens: 10, totalTokens: 110,
      },
    });
    const batch: ILivePromptTraceBatch = { ...completeBatch(), children: [
      at('2026-10-17T00:00:00.000Z', '2026-10-17T00:00:01.200Z', 'm-a'),
      at('2026-10-17T00:00:02.000Z', '2026-10-17T00:00:02.500Z', 'm-a'),
      at('2026-10-17T00:00:03.000Z', '2026-10-17T00:02:03.000Z', 'm-b'),
    ] };
    const metrics = new Map(metricsOf(batch, GEN_AI).map((metric) => [metric.descriptor.name, metric]));
    const durations = metrics.get('gen_ai.client.inference.duration')!.dataPoints as Array<{
      attributes: Record<string, unknown>;
      value: { buckets: { boundaries: number[]; counts: number[] }; sum: number; count: number; min: number; max: number };
    }>;
    expect(durations.map((point) => point.attributes['gen_ai.request.model'])).toEqual(['m-a', 'm-b']);
    const [modelA, modelB] = durations.map((point) => point.value);
    expect(modelA).toMatchObject({ count: 2, min: 0.5, max: 1.2 });
    expect(modelA!.sum).toBeCloseTo(1.7, 10);
    expect(modelA!.buckets.counts).toHaveLength(GEN_AI_DURATION_BUCKETS_S.length + 1);
    expect(modelA!.buckets.counts.filter((count) => count > 0)).toEqual([1, 1]);
    // 120 s is above the last boundary: it lands in the overflow bucket.
    expect(modelB!.buckets.counts.at(-1)).toBe(1);
    expect(modelB!.buckets.counts.reduce((total, count) => total + count, 0)).toBe(1);
    const input = metrics.get('gen_ai.client.inference.usage.input_tokens')!;
    expect(input.dataPoints.map((point) => point.value)).toEqual([200, 100]);
    expect(metrics.get('gen_ai.invoke_agent.inference_calls')!.dataPoints.map((point) => (point.value as { sum: number }).sum)).toEqual([3]);
  });

  it('drops only the two agent token counters in gen_ai mode', () => {
    const agent = namesOf(completeBatch());
    const genAi = namesOf(completeBatch(), GEN_AI);
    expect(agent).toContain('agent.provider.input_tokens');
    expect(agent).toContain('agent.provider.output_tokens');
    expect(genAi).not.toContain('agent.provider.input_tokens');
    expect(genAi).not.toContain('agent.provider.output_tokens');
    expect(genAi.filter((name) => name.startsWith('agent.')))
      .toEqual(agent.filter((name) => name !== 'agent.provider.input_tokens' && name !== 'agent.provider.output_tokens'));
  });

  it('exports both name sets in gen_ai/dup mode', () => {
    const agent = namesOf(completeBatch());
    const dup = namesOf(completeBatch(), DUP);
    expect(dup.slice(0, agent.length)).toEqual(agent);
    expect(dup).toContain('agent.provider.input_tokens');
    expect(dup).toContain('gen_ai.client.inference.usage.input_tokens');
    expect(dup).toContain('gen_ai.invoke_agent.duration');
    expect(dup.slice(agent.length).every((name) => name.startsWith('gen_ai.'))).toBe(true);
  });

  it('exports no provider or tool derived GenAI metric while that part of the batch was omitted', () => {
    // richBatch omitted a provider child: the totals a GenAI backend would sum are unprovable.
    const providerOmitted = namesOf(richBatch(), GEN_AI).filter((name) => name.startsWith('gen_ai.'));
    expect(providerOmitted).toEqual(['gen_ai.execute_tool.duration', 'gen_ai.invoke_agent.duration', 'gen_ai.invoke_agent.tool_calls']);
    // Under `gen_ai` the agent token counters go only with their equivalent: unprovable totals stay absent either way.
    const toolOmitted = namesOf({ ...completeBatch(), omittedChildren: { provider: 0, tool: 2, permission: 2 } }, GEN_AI)
      .filter((name) => name.startsWith('gen_ai.'));
    expect(toolOmitted).not.toContain('gen_ai.execute_tool.duration');
    expect(toolOmitted).not.toContain('gen_ai.invoke_agent.tool_calls');
    expect(toolOmitted).toContain('gen_ai.invoke_agent.inference_calls');
  });

  describe('metric attribute opt-ins', () => {
    const points = (naming: ILiveMetricNaming, attributes: ReadonlySet<TLiveMetricAttribute>) =>
      metricsOf(completeBatch(), naming, attributes)
        .filter((metric) => metric.descriptor.name.startsWith('gen_ai.'))
        .flatMap((metric) => metric.dataPoints.map((point) => ({ name: metric.descriptor.name, attributes: point.attributes as Record<string, unknown> })));

    it('stamps the session on GenAI points when the session attribute is on', () => {
      const stamped = points(GEN_AI, new Set(['session']));
      expect(stamped.length).toBeGreaterThan(0);
      for (const point of stamped) expect(point.attributes['agent.session.id']).toBe('session.1');
      for (const point of points(GEN_AI, new Set())) expect(point.attributes).not.toHaveProperty('agent.session.id');
    });

    it('keeps the request model on GenAI points whatever the provider and model opt-ins say', () => {
      for (const attributes of [new Set<TLiveMetricAttribute>(), new Set<TLiveMetricAttribute>(['provider', 'model'])]) {
        const chat = points(GEN_AI, attributes).filter((point) => point.name === 'gen_ai.client.inference.duration');
        expect(chat.map((point) => point.attributes['gen_ai.request.model'])).toEqual(['claude-sonnet-4-5', undefined]);
        for (const point of points(GEN_AI, attributes)) {
          expect(point.attributes).not.toHaveProperty('agent.provider.id');
          expect(point.attributes).not.toHaveProperty('agent.model.id');
        }
      }
    });

    it('leaves the agent metrics their own opt-in model label under gen_ai/dup', () => {
      const calls = metricsOf(completeBatch(), DUP, new Set(['model'])).find((metric) => metric.descriptor.name === 'agent.provider.calls')!;
      expect(calls.dataPoints.map((point) => point.attributes['agent.model.id'])).toEqual(['claude-sonnet-4-5', undefined]);
    });
  });

  it('never puts content on a GenAI metric', () => {
    const base = completeBatch();
    const leaky: ILivePromptTraceBatch = { ...base, sessionId: 'private session', children: base.children.map((child) => child.kind === 'tool'
      ? { ...child, trace: { ...child.trace, toolName: 'private tool output', toolCallId: 'private argument' } }
      : child.kind === 'provider' ? { ...child, trace: { ...child.trace, modelId: 'private prompt text', providerRequestId: 'private request' } } : child) };
    for (const naming of [DUP, GEN_AI]) {
      const text = JSON.stringify(metricsOf(leaky, naming, new Set(['provider', 'model'])).filter((metric) => metric.descriptor.name.startsWith('gen_ai.')));
      expect(text).toContain('gen_ai.client.inference.duration');
      expect(text).not.toMatch(/private/u);
    }
  });

  it('prints the GenAI metrics on the console under a GenAI mode, and today\'s record in agent mode', async () => {
    const print = async (naming?: ILiveMetricNaming) => {
      const lines: string[] = [];
      const port = createNodeLiveConsolePort('metrics', (line) => { lines.push(line); }, undefined, FIXED_RESOURCE, new Set(), naming);
      port.enqueue(completeBatch());
      await port.shutdown();
      return (JSON.parse(lines.pop()!) as { metrics: Array<{ name: string; unit: string; points: Array<{ value: unknown; attributes: Record<string, unknown> }> }> }).metrics;
    };
    const genAi = await print(GEN_AI);
    const names = genAi.map((metric) => metric.name);
    expect(names).toContain('gen_ai.client.inference.duration');
    expect(names).toContain('gen_ai.invoke_agent.tool_calls');
    expect(names).not.toContain('agent.provider.input_tokens');
    expect(genAi.find((metric) => metric.name === 'gen_ai.client.inference.duration')).toMatchObject({
      unit: 's', points: [{ value: { count: 1, sum: 1.2 }, attributes: { 'gen_ai.request.model': 'claude-sonnet-4-5' } }, { value: { count: 1 } }],
    });
    expect((await print()).map((metric) => metric.name).filter((name) => name.startsWith('gen_ai.'))).toEqual([]);
    expect((await print({ semconv: 'agent' })).map((metric) => metric.name)).toContain('agent.provider.input_tokens');
  });

  it('delivers the GenAI metrics through the OTLP metric port', async () => {
    const bodies: Buffer[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks));
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const endpoint = `http://127.0.0.1:${address.port}/v1/metrics`;
      for (const naming of [undefined, GEN_AI]) {
        const port = createNodeOtlpLiveMetricPort(endpoint, undefined, FIXED_RESOURCE, undefined, new Set(), naming);
        port.enqueue(completeBatch());
        await port.shutdown();
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.includes('gen_ai.')).toBe(false);
    for (const name of ['gen_ai.client.inference.duration', 'gen_ai.invoke_agent.tool_calls']) {
      expect(bodies[1]!.includes(name)).toBe(true);
    }
  });
});
