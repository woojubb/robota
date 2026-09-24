import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import { describe, expect, it } from 'vitest';
import { calculateModelCost } from '@robota-sdk/agent-core';
import { projectLivePromptMetrics } from '../live-metric-otlp.js';
import type { TLiveMetricAttribute } from '../live-metric-otlp.js';
import { createConfiguredNodeOtlpLiveTelemetryPort } from '../live-trace-otlp.js';

const base: ILivePromptTraceBatch = {
  schemaVersion: 1,
  sessionId: 'sess-42', turnId: 'turn-7',
  root: {
    traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef',
    startedAt: '2026-09-24T00:00:00.000Z', endedAt: '2026-09-24T00:00:02.000Z',
    outcome: 'success',
  },
  children: [],
  omittedChildren: { provider: 0, tool: 0, permission: 0 },
};

const window = {
  instanceId: 'test-instance',
  startTime: [1790208000, 0] as [number, number],
  endTime: [1790208002, 0] as [number, number],
};

function tool(spanId: string): ILivePromptTraceBatch['children'][number] {
  return { kind: 'tool', trace: {
    traceId: base.root.traceId, parentSpanId: base.root.spanId, spanId,
    startedAt: base.root.startedAt, endedAt: base.root.endedAt, outcome: 'success',
  } };
}

function permission(decision: string, toolCallId: string): ILivePromptTraceBatch['children'][number] {
  return { kind: 'permission', decision: {
    traceId: base.root.traceId, parentSpanId: base.root.spanId,
    decidedAt: base.root.startedAt, decision, toolCallId,
  } } as unknown as ILivePromptTraceBatch['children'][number];
}

function provider(
  providerId: string | undefined, modelId: string | undefined,
  usageProvenance: 'complete' | 'partial' | 'absent' = 'complete',
): ILivePromptTraceBatch['children'][number] {
  return { kind: 'provider', trace: {
    traceId: base.root.traceId, parentSpanId: base.root.spanId, spanId: 'abcdef1234567890',
    startedAt: base.root.startedAt, endedAt: base.root.endedAt,
    outcome: 'success', round: 1, disposition: 'invoked', usageProvenance,
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(usageProvenance === 'complete' ? { promptTokens: 100, completionTokens: 50, totalTokens: 150 } : {}),
  } };
}

function metricsOf(batch: ILivePromptTraceBatch, attrs?: ReadonlySet<TLiveMetricAttribute>) {
  return projectLivePromptMetrics(batch, window, attrs).scopeMetrics[0]!.metrics;
}

function metric(batch: ILivePromptTraceBatch, name: string, attrs?: ReadonlySet<TLiveMetricAttribute>) {
  return metricsOf(batch, attrs).find((item) => item.descriptor.name === name);
}

describe('metric attribute opt-in — default output', () => {
  it('is byte-identical to the pre-opt-in projection with no attributes selected', () => {
    const batch: ILivePromptTraceBatch = {
      ...base,
      children: [
        tool('1111111111111111'),
        provider('acme', 'gpt-4o'),
        permission('allowed', '1111111111111111'),
      ],
    };
    const withNoArg = JSON.stringify(metricsOf(batch));
    const withEmptySet = JSON.stringify(metricsOf(batch, new Set()));
    expect(withNoArg).toBe(withEmptySet);
    const parsed = JSON.parse(withNoArg) as Array<{ descriptor: { name: string }; dataPoints: Array<{ attributes: Record<string, unknown> }> }>;
    const names = parsed.map((item) => item.descriptor.name);
    expect(names).toEqual([
      'robota.prompt.executions',
      'robota.tool.body_completions',
      'robota.tool.permission_decisions',
      'robota.provider.calls',
      'robota.provider.input_tokens',
      'robota.provider.output_tokens',
      'robota.provider.estimated_cost_usd',
    ]);
    for (const item of parsed) {
      for (const point of item.dataPoints) {
        expect(point.attributes['robota.session.id']).toBeUndefined();
        expect(point.attributes['robota.provider.id']).toBeUndefined();
        expect(point.attributes['robota.model.id']).toBeUndefined();
      }
    }
    // permission_decisions keeps only its existing decision-value label by default.
    const decisions = parsed.find((item) => item.descriptor.name === 'robota.tool.permission_decisions')!;
    expect(decisions.dataPoints[0]!.attributes).toEqual({ 'robota.permission.decision': 'allowed' });
    const cost = parsed.find((item) => item.descriptor.name === 'robota.provider.estimated_cost_usd')!;
    expect(cost.dataPoints[0]!.attributes).toEqual({ 'robota.cost.provenance': 'price-table-calculated' });
  });
});

describe('metric attribute opt-in — session', () => {
  const attrs = new Set<TLiveMetricAttribute>(['session']);

  it('stamps robota.session.id on every datapoint, including omitted counts and permission decisions', () => {
    const batch: ILivePromptTraceBatch = {
      ...base,
      children: [tool('1111111111111111'), provider('acme', 'gpt-4o'), permission('allowed', '1111111111111111')],
      omittedChildren: { provider: 0, tool: 0, permission: 0 },
    };
    for (const item of metricsOf(batch, attrs)) {
      for (const point of item.dataPoints) {
        expect(point.attributes['robota.session.id']).toBe('sess-42');
      }
    }
  });

  it('stamps the session id on an omitted-count metric even when the underlying records are truncated', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [], omittedChildren: { provider: 3, tool: 2, permission: 1 },
    };
    const toolOmitted = metric(batch, 'robota.telemetry.tool_events_omitted', attrs)!;
    const providerOmitted = metric(batch, 'robota.telemetry.provider_events_omitted', attrs)!;
    const permissionOmitted = metric(batch, 'robota.telemetry.permission_events_omitted', attrs)!;
    expect(toolOmitted.dataPoints[0]!.attributes['robota.session.id']).toBe('sess-42');
    expect(providerOmitted.dataPoints[0]!.attributes['robota.session.id']).toBe('sess-42');
    expect(permissionOmitted.dataPoints[0]!.attributes['robota.session.id']).toBe('sess-42');
  });

  it('keeps the session id alongside the cost provenance label on the priced-cost datapoint', () => {
    const batch: ILivePromptTraceBatch = { ...base, children: [provider('acme', 'gpt-4o')] };
    const cost = metric(batch, 'robota.provider.estimated_cost_usd', attrs)!;
    expect(cost.dataPoints[0]!.attributes).toEqual({
      'robota.session.id': 'sess-42', 'robota.cost.provenance': 'price-table-calculated',
    });
  });
});

describe('metric attribute opt-in — provider/model grouping', () => {
  it('groups two providers with the same model into a single datapoint when only model is enabled', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [provider('acme', 'gpt-4o'), provider('other-co', 'gpt-4o')],
    };
    const calls = metric(batch, 'robota.provider.calls', new Set(['model']))!;
    expect(calls.dataPoints).toHaveLength(1);
    expect(calls.dataPoints[0]!.value).toBe(2);
    expect(calls.dataPoints[0]!.attributes).toEqual({ 'robota.model.id': 'gpt-4o' });
  });

  it('splits by provider id alone when only provider is enabled', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [provider('acme', 'gpt-4o'), provider('acme', 'gpt-4o-mini'), provider('other-co', 'gpt-4o')],
    };
    const calls = metric(batch, 'robota.provider.calls', new Set(['provider']))!;
    expect(calls.dataPoints).toHaveLength(2);
    const byProvider = Object.fromEntries(calls.dataPoints.map((point) => [point.attributes['robota.provider.id'], point.value]));
    expect(byProvider).toEqual({ acme: 2, 'other-co': 1 });
    for (const point of calls.dataPoints) expect(point.attributes['robota.model.id']).toBeUndefined();
  });

  it('groups by the (provider, model) pair when both are enabled', () => {
    const batch: ILivePromptTraceBatch = {
      ...base,
      children: [provider('acme', 'gpt-4o'), provider('acme', 'gpt-4o-mini'), provider('other-co', 'gpt-4o')],
    };
    const calls = metric(batch, 'robota.provider.calls', new Set(['provider', 'model']))!;
    expect(calls.dataPoints).toHaveLength(3);
    const keys = calls.dataPoints.map((point) => `${point.attributes['robota.provider.id']}/${point.attributes['robota.model.id']}`).sort();
    expect(keys).toEqual(['acme/gpt-4o', 'acme/gpt-4o-mini', 'other-co/gpt-4o']);
  });

  it('groups a call missing an id on its own, without a placeholder attribute', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [provider('acme', 'gpt-4o'), provider(undefined, undefined)],
    };
    const calls = metric(batch, 'robota.provider.calls', new Set(['provider', 'model']))!;
    expect(calls.dataPoints).toHaveLength(2);
    const withoutIds = calls.dataPoints.find((point) => Object.keys(point.attributes).length === 0);
    expect(withoutIds).toBeDefined();
    expect(withoutIds!.value).toBe(1);
    const withIds = calls.dataPoints.find((point) => Object.keys(point.attributes).length > 0)!;
    expect(withIds.attributes).toEqual({ 'robota.provider.id': 'acme', 'robota.model.id': 'gpt-4o' });
  });

  it('emits a priced estimated-cost datapoint per group and omits an unpriced group entirely', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [provider('acme', 'gpt-4o'), provider('acme', 'unknown-model')],
    };
    const cost = metric(batch, 'robota.provider.estimated_cost_usd', new Set(['provider', 'model']))!;
    expect(cost.dataPoints).toHaveLength(1);
    expect(cost.dataPoints[0]!.attributes).toEqual({
      'robota.provider.id': 'acme', 'robota.model.id': 'gpt-4o', 'robota.cost.provenance': 'price-table-calculated',
    });
    expect(cost.dataPoints[0]!.value).toBe(calculateModelCost('gpt-4o', 100, 50));
  });

  it('never repeats an attribute set within one metric and combines session with provider/model', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [provider('acme', 'gpt-4o'), provider('acme', 'gpt-4o'), provider('other-co', 'gpt-4o')],
    };
    const calls = metric(batch, 'robota.provider.calls', new Set(['session', 'provider']))!;
    expect(calls.dataPoints).toHaveLength(2);
    const seen = new Set(calls.dataPoints.map((point) => JSON.stringify(point.attributes)));
    expect(seen.size).toBe(2);
    for (const point of calls.dataPoints) expect(point.attributes['robota.session.id']).toBe('sess-42');
  });

  it('still withholds provider metrics entirely when any provider child was omitted', () => {
    const batch: ILivePromptTraceBatch = {
      ...base, children: [provider('acme', 'gpt-4o')], omittedChildren: { provider: 1, tool: 0, permission: 0 },
    };
    expect(metric(batch, 'robota.provider.calls', new Set(['provider', 'model']))).toBeUndefined();
  });
});

describe('metric attribute opt-in — configuration', () => {
  const enabledOtlp = {
    ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'otlp',
    ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  };

  it.each([
    ['bogus', 1], ['Model', 1], [' model', 1], ['', 1], ['session,session', 2], ['provider,,model', 2],
  ])('refuses an invalid token %s naming only the setting and position, never the raw text', async (value, position) => {
    let error: unknown;
    try {
      createConfiguredNodeOtlpLiveTelemetryPort({ ...enabledOtlp, ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: value });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('ROBOTA_TELEMETRY_METRIC_ATTRIBUTES');
    expect(message).toContain(String(position));
    if (value.trim().length > 0) expect(message).not.toContain(value.trim());
  });

  it('refuses the setting when metrics are neither otlp nor console', () => {
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'session',
    })).toThrow(/ROBOTA_TELEMETRY_METRIC_ATTRIBUTES/);
    expect(() => createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'off', ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'session',
    })).toThrow(/ROBOTA_TELEMETRY_METRIC_ATTRIBUTES/);
  });

  it('does not error when telemetry is disabled, whatever the value', () => {
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'not-a-real-token',
    })).toBeUndefined();
    expect(createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '0', ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'not-a-real-token',
    })).toBeUndefined();
  });

  it('accepts a canonical comma list when metrics export over otlp', async () => {
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ...enabledOtlp, ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'session,provider,model',
    });
    expect(port).toBeDefined();
    await port?.shutdown();
  });

  it('accepts a canonical comma list when metrics export over console', async () => {
    const lines: string[] = [];
    const port = createConfiguredNodeOtlpLiveTelemetryPort({
      ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_METRICS: 'console',
      ROBOTA_TELEMETRY_METRIC_ATTRIBUTES: 'session',
    }, undefined, (line) => { lines.push(line); });
    expect(port).toBeDefined();
    port!.enqueue({ ...base, children: [provider('acme', 'gpt-4o')] });
    await port!.shutdown();
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as { metrics: Array<{ points: Array<{ attributes: Record<string, unknown> }> }> };
    const callsMetric = record.metrics.find((item) =>
      item.points.some((point) => 'value' in point));
    expect(callsMetric).toBeDefined();
    const stamped = record.metrics.every((item) => item.points.every((point) => point.attributes['robota.session.id'] === 'sess-42'));
    expect(stamped).toBe(true);
  });
});
