import { randomUUID } from 'node:crypto';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { ILivePromptTracePort } from '@robota-sdk/agent-framework';
import { projectLivePromptMetrics } from './live-metric-otlp.js';
import { projectLivePromptLogs } from './live-log-otlp.js';

type TSignal = 'traces' | 'metrics' | 'logs';

/** Console is a diagnostic projection of the same content-free facts, never a batch dump. */
function projectConsoleRecord(batch: ILivePromptTraceBatch, signal: TSignal): object {
  if (signal === 'metrics') {
    const end = Date.now();
    const metricBatch = projectLivePromptMetrics(batch, {
      instanceId: randomUUID(),
      startTime: [Math.floor((end - 1) / 1000), ((end - 1) % 1000) * 1_000_000],
      endTime: [Math.floor(end / 1000), (end % 1000) * 1_000_000],
    });
    return { signal, metrics: metricBatch.scopeMetrics.flatMap((scope) => scope.metrics.map((metric) => ({
      name: metric.descriptor.name, unit: metric.descriptor.unit,
      points: metric.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes })),
    }))) };
  }
  if (signal === 'logs') {
    return { signal, events: projectLivePromptLogs(batch, new Date()).map((log) => ({
      name: log.eventName, severity: log.severityText,
      traceId: log.spanContext?.traceId, spanId: log.spanContext?.spanId,
      time: log.hrTime, attributes: log.attributes,
    })) };
  }
  return {
    signal, traceId: batch.root.traceId,
    spans: [
      { name: 'robota.prompt_execution', spanId: batch.root.spanId,
        startedAt: batch.root.startedAt, endedAt: batch.root.endedAt,
        outcome: batch.root.outcome,
        omittedProviderCount: batch.omittedChildren.provider,
        omittedToolCount: batch.omittedChildren.tool },
      ...batch.children.map((child) => ({
        name: child.kind === 'provider' ? 'robota.provider_call' : 'robota.tool_body',
        spanId: child.trace.spanId, parentSpanId: child.trace.parentSpanId,
        startedAt: child.trace.startedAt, endedAt: child.trace.endedAt,
        outcome: child.trace.outcome,
      })),
    ],
  };
}

export function createNodeLiveConsolePort(
  signal: TSignal,
  write: (line: string) => void | Promise<void>,
  onFailure?: (code: 'projection-failed' | 'enqueue-failed' | 'delivery-failed') => void,
): ILivePromptTracePort & { shutdown(): Promise<void> } {
  const reportFailure = (): void => {
    try { void Promise.resolve(onFailure?.('delivery-failed')).catch(() => undefined); }
    catch { /* diagnostics must not affect the turn */ }
  };
  return {
    ...(onFailure ? { onFailure } : {}),
    enqueue(batch) {
      try { void Promise.resolve(write(`${JSON.stringify(projectConsoleRecord(batch, signal))}\n`))
        .catch(reportFailure); }
      catch { reportFailure(); }
    },
    async shutdown() { /* no background worker */ },
  };
}
