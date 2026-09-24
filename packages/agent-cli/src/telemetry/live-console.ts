import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { ILivePromptTracePort } from '@robota-sdk/agent-framework';
import { projectLivePromptMetrics } from './live-metric-otlp.js';
import type { TLiveMetricAttribute } from './live-metric-otlp.js';
import { projectLivePromptLogs } from './live-log-otlp.js';
import { createLiveTelemetryResource, safeLiveProviderRequestId, safeLiveToolCallId } from './live-resource.js';
import type { ILiveTelemetryResource } from './live-resource.js';

type TSignal = 'traces' | 'metrics' | 'logs';
type TSpannedChild = Exclude<ILivePromptTraceBatch['children'][number], { readonly kind: 'permission' }>;
const MAX_PENDING_BATCHES = 8;
const WRITE_TIMEOUT_MS = 5_000;
const boundedLabel = (value: string | undefined): string | undefined => value?.slice(0, 128);

/** A permission decision is content-free but has no duration of its own — it never gets a span. */
function hasSpan(child: ILivePromptTraceBatch['children'][number]): child is TSpannedChild {
  return child.kind !== 'permission';
}

async function writeWithDeadline(write: (line: string) => void | Promise<void>, line: string): Promise<void> {
  const result = write(line);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(result),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Console telemetry write timed out.')), WRITE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Console is a diagnostic projection of the same content-free facts, never a batch dump. */
function projectConsoleRecord(
  batch: ILivePromptTraceBatch, signal: TSignal, resource: ILiveTelemetryResource,
  metricAttributes: ReadonlySet<TLiveMetricAttribute>,
): object {
  if (signal === 'metrics') {
    const end = Date.now();
    const metricBatch = projectLivePromptMetrics(batch, {
      instanceId: resource.instanceId, resource,
      startTime: [Math.floor((end - 1) / 1000), ((end - 1) % 1000) * 1_000_000],
      endTime: [Math.floor(end / 1000), (end % 1000) * 1_000_000],
    }, metricAttributes);
    return { signal, resource: resource.attributes, metrics: metricBatch.scopeMetrics.flatMap((scope) => scope.metrics.map((metric) => ({
      name: metric.descriptor.name, unit: metric.descriptor.unit,
      points: metric.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes })),
    }))) };
  }
  if (signal === 'logs') {
    return { signal, resource: resource.attributes, events: projectLivePromptLogs(batch, new Date(), resource).map((log) => ({
      name: log.eventName, severity: log.severityText,
      traceId: log.spanContext?.traceId, spanId: log.spanContext?.spanId,
      time: log.hrTime, attributes: log.attributes,
    })) };
  }
  return {
    signal, resource: resource.attributes, traceId: batch.root.traceId,
    sessionId: boundedLabel(batch.sessionId), turnId: boundedLabel(batch.turnId),
    spans: [
      { name: 'robota.prompt_execution', spanId: batch.root.spanId,
        startedAt: batch.root.startedAt, endedAt: batch.root.endedAt,
        outcome: batch.root.outcome,
        omittedProviderCount: batch.omittedChildren.provider,
        omittedToolCount: batch.omittedChildren.tool,
        omittedPermissionCount: batch.omittedChildren.permission },
      ...batch.children.filter(hasSpan).map((child) => ({
        name: child.kind === 'provider' ? 'robota.provider_call' : 'robota.tool_body',
        spanId: child.trace.spanId, parentSpanId: child.trace.parentSpanId,
        startedAt: child.trace.startedAt, endedAt: child.trace.endedAt,
        outcome: child.trace.outcome,
        ...(child.kind === 'provider' ? {
          round: child.trace.round, disposition: child.trace.disposition,
          providerId: boundedLabel(child.trace.providerId),
          modelId: boundedLabel(child.trace.modelId),
          usageProvenance: child.trace.usageProvenance,
          ...(child.trace.usageProvenance === 'complete' ? {
            promptTokens: child.trace.promptTokens,
            completionTokens: child.trace.completionTokens,
            totalTokens: child.trace.totalTokens,
          } : {}),
          providerRequestId: safeLiveProviderRequestId(child.trace.providerRequestId),
        } : { toolCallId: safeLiveToolCallId(child.trace.toolCallId) }),
      })),
    ],
  };
}

export function createNodeLiveConsolePort(
  signal: TSignal,
  write: (line: string) => void | Promise<void>,
  onFailure?: (code: 'projection-failed' | 'enqueue-failed' | 'delivery-failed') => void,
  resource: ILiveTelemetryResource = createLiveTelemetryResource(),
  /** Parsed once at the config boundary from `ROBOTA_TELEMETRY_METRIC_ATTRIBUTES`; empty by default. */
  metricAttributes: ReadonlySet<TLiveMetricAttribute> = new Set(),
): ILivePromptTracePort & { shutdown(): Promise<void> } {
  const pending: ILivePromptTraceBatch[] = [];
  let worker: Promise<void> | undefined;
  let closed = false;
  const reportFailure = (code: 'projection-failed' | 'delivery-failed'): void => {
    try { void Promise.resolve(onFailure?.(code)).catch(() => undefined); }
    catch { /* diagnostics must not affect the turn */ }
  };
  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      const batch = pending.shift()!;
      let line: string;
      try { line = `${JSON.stringify(projectConsoleRecord(batch, signal, resource, metricAttributes))}\n`; }
      catch { reportFailure('projection-failed'); continue; }
      try { await writeWithDeadline(write, line); }
      catch {
        pending.length = 0;
        reportFailure('delivery-failed');
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
      if (closed || pending.length >= MAX_PENDING_BATCHES) throw new Error('Live console queue unavailable.');
      pending.push(batch);
      start();
    },
    async shutdown() {
      closed = true;
      while (worker) await worker;
    },
  };
}
