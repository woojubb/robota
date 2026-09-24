import { TraceFlags } from '@opentelemetry/api';
import type { HrTime } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ProtobufLogsSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { ILivePromptTracePort } from '@robota-sdk/agent-framework';
import { createLiveTelemetryResource, safeLiveToolCallId } from './live-resource.js';
import type { ILiveTelemetryResource } from './live-resource.js';

const MAX_PENDING_BATCHES = 8;

function hrTime(iso: string): HrTime {
  const milliseconds = Date.parse(iso);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error('Invalid live log timestamp.');
  }
  return [Math.floor(milliseconds / 1000), (milliseconds % 1000) * 1_000_000];
}

/** Only canonical completion facts cross the log boundary; no message or tool body is serialized. */
export function projectLivePromptLogs(
  batch: ILivePromptTraceBatch, observedAt: Date,
  identity: ILiveTelemetryResource = createLiveTelemetryResource(),
): ReadableLogRecord[] {
  const resource = resourceFromAttributes(identity.attributes);
  const instrumentationScope = { name: 'robota.live-prompt-logs', version: '1' };
  const hrTimeObserved = hrTime(observedAt.toISOString());
  const record = (
    eventName: 'robota.prompt_execution.completed' | 'robota.provider_call.completed' | 'robota.tool_body.completed',
    outcome: ILivePromptTraceBatch['root']['outcome'],
    endedAt: string,
    spanId: string,
    attributes: Record<string, string | number>,
  ): ReadableLogRecord => ({
    hrTime: hrTime(endedAt), hrTimeObserved,
    spanContext: { traceId: batch.root.traceId, spanId, traceFlags: TraceFlags.NONE },
    eventName,
    severityNumber: outcome === 'success' ? SeverityNumber.INFO
      : outcome === 'failure' ? SeverityNumber.ERROR : SeverityNumber.WARN,
    severityText: outcome === 'success' ? 'INFO' : outcome === 'failure' ? 'ERROR' : 'WARN',
    resource, instrumentationScope, attributes, droppedAttributesCount: 0,
  });
  const logs: ReadableLogRecord[] = [];
  for (const child of batch.children) {
    if (child.kind === 'provider') {
      if (child.trace.disposition !== 'invoked') continue;
      logs.push(record('robota.provider_call.completed', child.trace.outcome,
        child.trace.endedAt, child.trace.spanId, { 'robota.provider.outcome': child.trace.outcome }));
    } else {
      const toolCallId = safeLiveToolCallId(child.trace.toolCallId);
      logs.push(record('robota.tool_body.completed', child.trace.outcome,
        child.trace.endedAt, child.trace.spanId, {
          'robota.tool.outcome': child.trace.outcome,
          ...(toolCallId ? { 'robota.tool.call_id': toolCallId } : {}),
        }));
    }
  }
  logs.push(record('robota.prompt_execution.completed', batch.root.outcome,
    batch.root.endedAt, batch.root.spanId, {
      'robota.prompt.outcome': batch.root.outcome,
      ...(batch.omittedChildren.provider > 0
        ? { 'robota.telemetry.omitted_provider_events': batch.omittedChildren.provider } : {}),
      ...(batch.omittedChildren.tool > 0
        ? { 'robota.telemetry.omitted_tool_events': batch.omittedChildren.tool } : {}),
    }));
  return logs;
}

async function sendLogs(batch: ILivePromptTraceBatch, endpoint: string, resource: ILiveTelemetryResource): Promise<void> {
  const body = ProtobufLogsSerializer.serializeRequest(projectLivePromptLogs(batch, new Date(), resource));
  if (!body || body.byteLength > 1_048_576) throw new Error('Invalid OTLP log payload.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-protobuf' },
    body: Buffer.from(body),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200 ||
    !response.headers.get('content-type')?.startsWith('application/x-protobuf')) {
    throw new Error('OTLP collector rejected logs.');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 65_536) throw new Error('OTLP log response exceeded the size limit.');
      chunks.push(chunk);
    }
  }
  if (length > 0) {
    const decoded = ProtobufLogsSerializer.deserializeResponse(Buffer.concat(chunks));
    if ((decoded.partialSuccess?.rejectedLogRecords ?? 0) > 0) {
      throw new Error('OTLP collector partially rejected logs.');
    }
  }
}

/** One bounded host-owned queue; collector failures never change prompt settlement. */
export function createNodeOtlpLiveLogPort(
  endpoint: string,
  onFailure?: (code: 'projection-failed' | 'enqueue-failed' | 'delivery-failed') => void,
  resource: ILiveTelemetryResource = createLiveTelemetryResource(),
): ILivePromptTracePort & { shutdown(): Promise<void> } {
  const pending: ILivePromptTraceBatch[] = [];
  let worker: Promise<void> | undefined;
  let closed = false;
  const reportFailure = (): void => {
    try { void Promise.resolve(onFailure?.('delivery-failed')).catch(() => undefined); }
    catch { /* diagnostics are isolated */ }
  };
  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      try { await sendLogs(pending.shift()!, endpoint, resource); }
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
      if (closed || pending.length >= MAX_PENDING_BATCHES) throw new Error('Live log queue unavailable.');
      pending.push(batch);
      start();
    },
    async shutdown() {
      closed = true;
      while (worker) await worker;
    },
  };
}
