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

/** Delta sums describe this one prompt only; no resumed history is replayed or counted twice. */
export function projectLivePromptMetrics(batch: ILivePromptTraceBatch, window: IMetricWindow): ResourceMetrics {
  const { startTime, endTime } = window;
  const metrics: MetricData[] = [];
  const addSum = (name: string, value: number, unit: string, valueType = ValueType.INT,
    attributes: Record<string, string> = {}, includeZero = false): void => {
    if (value < 0 || (value === 0 && !includeZero)) return;
    metrics.push({
      descriptor: { name, description: '', unit, valueType },
      aggregationTemporality: AggregationTemporality.DELTA,
      dataPointType: DataPointType.SUM,
      isMonotonic: true,
      dataPoints: [{ startTime, endTime, attributes, value }],
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
        startTime, endTime, attributes: { 'robota.permission.decision': decision }, value: count,
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
    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let missingUsage = 0;
    let unpricedCalls = 0;
    let pricedCalls = 0;
    for (const child of batch.children) {
      if (child.kind !== 'provider' || child.trace.disposition !== 'invoked') continue;
      calls += 1;
      const call = child.trace;
      if (call.usageProvenance !== 'complete' ||
        call.promptTokens === undefined || call.completionTokens === undefined) {
        missingUsage += 1;
        continue;
      }
      inputTokens += call.promptTokens;
      outputTokens += call.completionTokens;
      const cost = call.modelId === undefined ? undefined
        : calculateModelCost(call.modelId, call.promptTokens, call.completionTokens);
      if (cost === undefined) unpricedCalls += 1;
      else {
        pricedCalls += 1;
        estimatedCost += cost;
      }
    }
    addSum('robota.provider.calls', calls, '1');
    addSum('robota.provider.input_tokens', inputTokens, '{token}');
    addSum('robota.provider.output_tokens', outputTokens, '{token}');
    addSum('robota.provider.usage_unavailable_calls', missingUsage, '1');
    addSum('robota.provider.cost_unpriced_calls', unpricedCalls, '1');
    if (pricedCalls > 0) addSum('robota.provider.estimated_cost_usd', estimatedCost, 'USD',
      ValueType.DOUBLE, { 'robota.cost.provenance': 'price-table-calculated' }, true);
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
): Promise<void> {
  const projected = projectLivePromptMetrics(batch, window);
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
        }, headers);
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
