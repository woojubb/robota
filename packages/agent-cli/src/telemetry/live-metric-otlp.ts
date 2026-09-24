import { ValueType } from '@opentelemetry/api';
import type { HrTime } from '@opentelemetry/api';
import { ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationTemporality, DataPointType } from '@opentelemetry/sdk-metrics';
import type { MetricData, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { calculateModelCost } from '@robota-sdk/agent-core';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { ILivePromptTracePort } from '@robota-sdk/agent-framework';
import { createLiveTelemetryResource } from './live-resource.js';
import type { ILiveTelemetryResource } from './live-resource.js';
import { otlpProtobufRequestHeaders } from './live-otlp-headers.js';

const MAX_PENDING_BATCHES = 8;

function hrTime(milliseconds: number): HrTime {
  return [Math.floor(milliseconds / 1000), (milliseconds % 1000) * 1_000_000];
}

interface IMetricWindow {
  /** Unique per host exporter; concurrent CLI processes cannot write the same metric stream. */
  instanceId: string;
  resource?: ILiveTelemetryResource;
  startTime: HrTime;
  endTime: HrTime;
}

/**
 * Metric labels are opt-in (`ROBOTA_TELEMETRY_METRIC_ATTRIBUTES`, parsed by the CLI's config
 * boundary): `session` stamps `robota.session.id` on every datapoint; `provider`/`model` split
 * only provider-derived metrics into per-group datapoints keyed by the enabled id(s), using the
 * same `robota.provider.id`/`robota.model.id` keys as the matching trace spans.
 */
export type TLiveMetricAttribute = 'session' | 'provider' | 'model';

interface IProviderMetricGroup {
  readonly attributes: Record<string, string>;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  missingUsage: number;
  unpricedCalls: number;
  pricedCalls: number;
  estimatedCost: number;
}

/** Delta sums describe this one prompt only; no resumed history is replayed or counted twice. */
export function projectLivePromptMetrics(
  batch: ILivePromptTraceBatch,
  window: IMetricWindow,
  metricAttributes: ReadonlySet<TLiveMetricAttribute> = new Set(),
): ResourceMetrics {
  const { startTime, endTime } = window;
  const metrics: MetricData[] = [];
  const includeSession = metricAttributes.has('session');
  const sessionAttributes: Record<string, string> = includeSession ? { 'robota.session.id': batch.sessionId } : {};
  const addSum = (name: string, value: number, unit: string, valueType = ValueType.INT,
    attributes: Record<string, string> = {}, includeZero = false): void => {
    if (value < 0 || (value === 0 && !includeZero)) return;
    metrics.push({
      descriptor: { name, description: '', unit, valueType },
      aggregationTemporality: AggregationTemporality.DELTA,
      dataPointType: DataPointType.SUM,
      isMonotonic: true,
      dataPoints: [{ startTime, endTime, attributes: { ...sessionAttributes, ...attributes }, value }],
    });
  };

  addSum('robota.prompt.executions', 1, '1');
  addSum('robota.telemetry.tool_events_omitted', batch.omittedChildren.tool, '1');
  if (batch.omittedChildren.tool === 0) {
    addSum('robota.tool.body_completions', batch.children.filter((child) => child.kind === 'tool').length, '1');
  }
  addSum('robota.telemetry.provider_events_omitted', batch.omittedChildren.provider, '1');
  addSum('robota.telemetry.permission_events_omitted', batch.omittedChildren.permission, '1');
  if (batch.omittedChildren.permission === 0) {
    const decisionCounts = new Map<string, number>();
    for (const child of batch.children) {
      if (child.kind !== 'permission') continue;
      decisionCounts.set(child.decision.decision, (decisionCounts.get(child.decision.decision) ?? 0) + 1);
    }
    const dataPoints = [...decisionCounts]
      .filter(([, count]) => count > 0)
      .map(([decision, count]) => ({
        startTime, endTime,
        attributes: { ...sessionAttributes, 'robota.permission.decision': decision }, value: count,
      }));
    if (dataPoints.length > 0) metrics.push({
      descriptor: { name: 'robota.tool.permission_decisions', description: '', unit: '1', valueType: ValueType.INT },
      aggregationTemporality: AggregationTemporality.DELTA,
      dataPointType: DataPointType.SUM,
      isMonotonic: true,
      dataPoints,
    });
  }
  // The live trace port bounds its child list. A truncated list cannot prove a complete total.
  if (batch.omittedChildren.provider === 0) {
    const splitByProvider = metricAttributes.has('provider');
    const splitByModel = metricAttributes.has('model');
    const groups = new Map<string, IProviderMetricGroup>();
    const groupFor = (providerId: string | undefined, modelId: string | undefined): IProviderMetricGroup => {
      // A structured key, never a joined label: an id may itself contain ':', '/' or '.'.
      const key = JSON.stringify([
        ...(splitByProvider ? [providerId ?? null] : []),
        ...(splitByModel ? [modelId ?? null] : []),
      ]);
      let group = groups.get(key);
      if (!group) {
        const attributes: Record<string, string> = { ...sessionAttributes };
        if (splitByProvider && providerId !== undefined) attributes['robota.provider.id'] = providerId;
        if (splitByModel && modelId !== undefined) attributes['robota.model.id'] = modelId;
        group = {
          attributes, calls: 0, inputTokens: 0, outputTokens: 0,
          missingUsage: 0, unpricedCalls: 0, pricedCalls: 0, estimatedCost: 0,
        };
        groups.set(key, group);
      }
      return group;
    };
    for (const child of batch.children) {
      if (child.kind !== 'provider' || child.trace.disposition !== 'invoked') continue;
      const call = child.trace;
      const group = groupFor(call.providerId, call.modelId);
      group.calls += 1;
      if (call.usageProvenance !== 'complete' ||
        call.promptTokens === undefined || call.completionTokens === undefined) {
        group.missingUsage += 1;
        continue;
      }
      group.inputTokens += call.promptTokens;
      group.outputTokens += call.completionTokens;
      const cost = call.modelId === undefined ? undefined
        : calculateModelCost(call.modelId, call.promptTokens, call.completionTokens);
      if (cost === undefined) group.unpricedCalls += 1;
      else {
        group.pricedCalls += 1;
        group.estimatedCost += cost;
      }
    }
    const orderedGroups = [...groups.values()];
    const addGroupedSum = (
      name: string, unit: string, valueType: ValueType, selector: (group: IProviderMetricGroup) => number,
    ): void => {
      const dataPoints = orderedGroups
        .map((group) => ({ startTime, endTime, attributes: group.attributes, value: selector(group) }))
        .filter((point) => point.value > 0);
      if (dataPoints.length > 0) metrics.push({
        descriptor: { name, description: '', unit, valueType },
        aggregationTemporality: AggregationTemporality.DELTA,
        dataPointType: DataPointType.SUM,
        isMonotonic: true,
        dataPoints,
      });
    };
    addGroupedSum('robota.provider.calls', '1', ValueType.INT, (group) => group.calls);
    addGroupedSum('robota.provider.input_tokens', '{token}', ValueType.INT, (group) => group.inputTokens);
    addGroupedSum('robota.provider.output_tokens', '{token}', ValueType.INT, (group) => group.outputTokens);
    addGroupedSum('robota.provider.usage_unavailable_calls', '1', ValueType.INT, (group) => group.missingUsage);
    addGroupedSum('robota.provider.cost_unpriced_calls', '1', ValueType.INT, (group) => group.unpricedCalls);
    const pricedGroups = orderedGroups.filter((group) => group.pricedCalls > 0 && group.estimatedCost >= 0);
    if (pricedGroups.length > 0) metrics.push({
      descriptor: { name: 'robota.provider.estimated_cost_usd', description: '', unit: 'USD', valueType: ValueType.DOUBLE },
      aggregationTemporality: AggregationTemporality.DELTA,
      dataPointType: DataPointType.SUM,
      isMonotonic: true,
      dataPoints: pricedGroups.map((group) => ({
        startTime, endTime,
        attributes: { ...group.attributes, 'robota.cost.provenance': 'price-table-calculated' },
        value: group.estimatedCost,
      })),
    });
  }
  return {
    resource: resourceFromAttributes(window.resource?.attributes ?? {
      'service.name': 'robota', 'service.instance.id': window.instanceId,
    }),
    scopeMetrics: [{ scope: { name: 'robota.live-prompt-metrics', version: '1' }, metrics }],
  };
}

async function sendMetrics(
  batch: ILivePromptTraceBatch, endpoint: string, window: IMetricWindow, headers: Headers | undefined,
  metricAttributes: ReadonlySet<TLiveMetricAttribute>,
): Promise<void> {
  const projected = projectLivePromptMetrics(batch, window, metricAttributes);
  if (projected.scopeMetrics[0]?.metrics.length === 0) return;
  const body = ProtobufMetricsSerializer.serializeRequest(projected);
  if (!body || body.byteLength > 1_048_576) throw new Error('Invalid OTLP metric payload.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: otlpProtobufRequestHeaders(headers),
    body: Buffer.from(body),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200 ||
    !response.headers.get('content-type')?.startsWith('application/x-protobuf')) {
    throw new Error('OTLP collector rejected metrics.');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 65_536) throw new Error('OTLP metric response exceeded the size limit.');
      chunks.push(chunk);
    }
  }
  if (length > 0) {
    const decoded = ProtobufMetricsSerializer.deserializeResponse(Buffer.concat(chunks));
    if ((decoded.partialSuccess?.rejectedDataPoints ?? 0) > 0) {
      throw new Error('OTLP collector partially rejected metrics.');
    }
  }
}

/** The host owns delivery and drains it on exit; a failing collector never fails the turn. */
export function createNodeOtlpLiveMetricPort(
  endpoint: string,
  onFailure?: (code: 'projection-failed' | 'enqueue-failed' | 'delivery-failed') => void,
  resource: ILiveTelemetryResource = createLiveTelemetryResource(),
  /** Static headers prebuilt at startup; the sender's own content type always overrides them. */
  headers?: Headers,
  /** Parsed once at the config boundary from `ROBOTA_TELEMETRY_METRIC_ATTRIBUTES`; empty by default. */
  metricAttributes: ReadonlySet<TLiveMetricAttribute> = new Set(),
): ILivePromptTracePort & { shutdown(): Promise<void> } {
  const pending: ILivePromptTraceBatch[] = [];
  let worker: Promise<void> | undefined;
  let closed = false;
  const instanceId = resource.instanceId;
  let previousEndMs: number | undefined;
  const reportFailure = (): void => {
    try { void Promise.resolve(onFailure?.('delivery-failed')).catch(() => undefined); }
    catch { /* diagnostics are isolated */ }
  };
  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      try {
        const endMs = Math.max(Date.now(), (previousEndMs ?? 0) + 1);
        const startMs = previousEndMs ?? endMs - 1;
        previousEndMs = endMs;
        await sendMetrics(pending.shift()!, endpoint, {
          instanceId, resource, startTime: hrTime(startMs), endTime: hrTime(endMs),
        }, headers, metricAttributes);
      }
      catch {
        pending.length = 0;
        reportFailure();
      }
    }
  };
  const start = (): void => {
    if (worker || pending.length === 0) return;
    worker = drain().finally(() => {
      worker = undefined;
      start();
    });
  };
  return {
    ...(onFailure ? { onFailure } : {}),
    enqueue(batch) {
      if (closed || pending.length >= MAX_PENDING_BATCHES) throw new Error('Live metric queue unavailable.');
      pending.push(batch);
      start();
    },
    async shutdown() {
      closed = true;
      while (worker) await worker;
    },
  };
}
