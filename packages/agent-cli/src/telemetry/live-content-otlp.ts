/**
 * Opt-in prompt/response content as OTLP log records. It has its own POST, queue and failure
 * scope beside the content-free logs, so a slow or failing content export can never delay or clear
 * a content-free batch, and a content-free failure never clears content. Redaction happens here, in
 * the export worker, per batch.
 */
import { TraceFlags } from '@opentelemetry/api';
import type { HrTime } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ProtobufLogsSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type {
  ILivePromptContentBatch,
  ILivePromptContentPolicy,
} from '@robota-sdk/agent-interface-analytics';
import { otlpProtobufRequestHeaders } from './live-otlp-headers.js';
import { prepareLiveContentRedactor } from './live-content-redaction.js';
import type { ILiveContentRedactionContext, TLiveContentRedactor } from './live-content-redaction.js';
import type { ILiveTelemetryResource } from './live-resource.js';

const MAX_PENDING_BATCHES = 8;
/** Total post-redaction body bytes one batch may export. */
export const LIVE_CONTENT_BATCH_BODY_BUDGET = 768 * 1024;
export const LIVE_CONTENT_BATCH_MAX_ITEMS = 64;

export interface INodeOtlpLiveContentPort {
  readonly policy: ILivePromptContentPolicy;
  enqueue(batch: ILivePromptContentBatch): void;
  shutdown(): Promise<void>;
}

export interface INodeOtlpLiveContentOptions {
  readonly endpoint: string;
  readonly headers?: Headers;
  readonly resource: ILiveTelemetryResource;
  readonly policy: ILivePromptContentPolicy;
  readonly redaction: ILiveContentRedactionContext;
  readonly onFailure?: (code: 'content-delivery-failed') => void;
}

function hrTime(iso: string): HrTime {
  const milliseconds = Date.parse(iso);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Invalid live content timestamp.');
  return [Math.floor(milliseconds / 1000), (milliseconds % 1000) * 1_000_000];
}

/**
 * The records one batch exports. `redactor` is undefined when the batch's secrets could not be
 * read: then nothing but the content-free omission count is exported.
 */
export function projectLiveContentLogs(
  batch: ILivePromptContentBatch,
  observedAt: Date,
  identity: ILiveTelemetryResource,
  policy: ILivePromptContentPolicy,
  redactor: TLiveContentRedactor | undefined,
): ReadableLogRecord[] {
  const resource = resourceFromAttributes(identity.attributes);
  const instrumentationScope = { name: 'robota.live-prompt-content', version: '1' };
  const base = {
    hrTime: hrTime(batch.root.endedAt),
    hrTimeObserved: hrTime(observedAt.toISOString()),
    spanContext: { traceId: batch.root.traceId, spanId: batch.root.spanId, traceFlags: TraceFlags.NONE },
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    resource, instrumentationScope, droppedAttributesCount: 0,
  };
  const records: ReadableLogRecord[] = [];
  let omitted = 0;
  let budget = LIVE_CONTENT_BATCH_BODY_BUDGET;
  for (const [index, item] of batch.items.entries()) {
    if (!redactor || index >= LIVE_CONTENT_BATCH_MAX_ITEMS) { omitted += 1; continue; }
    let redacted: ReturnType<TLiveContentRedactor>;
    try {
      redacted = redactor(item.text, policy.maxBytes, item.truncated);
    } catch {
      omitted += 1;
      continue;
    }
    const bytes = Buffer.byteLength(redacted.text, 'utf8');
    if (bytes > budget) { omitted += 1; continue; }
    budget -= bytes;
    records.push({
      ...base,
      eventName: 'robota.content.captured',
      body: redacted.text,
      attributes: {
        'robota.content.kind': item.kind,
        'robota.content.truncated': redacted.truncated,
        'robota.content.original_bytes': item.originalBytes,
        ...(item.partial === true ? { 'robota.content.partial': true } : {}),
      },
    });
  }
  if (omitted > 0) {
    records.push({
      ...base,
      eventName: 'robota.content.omitted',
      attributes: { 'robota.telemetry.omitted_content_items': omitted },
    });
  }
  return records;
}

async function post(records: ReadableLogRecord[], endpoint: string, headers: Headers | undefined): Promise<void> {
  const body = ProtobufLogsSerializer.serializeRequest(records);
  if (!body || body.byteLength > 1_048_576) throw new Error('Invalid OTLP content payload.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: otlpProtobufRequestHeaders(headers),
    body: Buffer.from(body),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200 ||
    !response.headers.get('content-type')?.startsWith('application/x-protobuf')) {
    throw new Error('OTLP collector rejected content logs.');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 65_536) throw new Error('OTLP content response exceeded the size limit.');
      chunks.push(chunk);
    }
  }
  if (length > 0) {
    const decoded = ProtobufLogsSerializer.deserializeResponse(Buffer.concat(chunks));
    if ((decoded.partialSuccess?.rejectedLogRecords ?? 0) > 0) throw new Error('OTLP collector partially rejected content logs.');
  }
}

/** Node-only host adapter for content records; the framework never waits for it. */
export function createNodeOtlpLiveContentPort(options: INodeOtlpLiveContentOptions): INodeOtlpLiveContentPort {
  const pending: ILivePromptContentBatch[] = [];
  let worker: Promise<void> | undefined;
  let closed = false;
  const reportFailure = (): void => {
    try { void Promise.resolve(options.onFailure?.('content-delivery-failed')).catch(() => undefined); }
    catch { /* diagnostics are isolated */ }
  };
  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      const batch = pending.shift()!;
      let redactor: TLiveContentRedactor | undefined;
      try { redactor = prepareLiveContentRedactor(options.redaction); }
      catch { redactor = undefined; }
      try {
        await post(projectLiveContentLogs(batch, new Date(), options.resource, options.policy, redactor),
          options.endpoint, options.headers);
        // Unreadable secrets drop the batch's content; that is a delivery failure, even though the
        // content-free omission record was sent.
        if (!redactor) reportFailure();
      } catch {
        // Only this queue is cleared: content-free logs have their own.
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
    policy: options.policy,
    enqueue(batch) {
      if (closed || pending.length >= MAX_PENDING_BATCHES) throw new Error('Live content queue unavailable.');
      pending.push(batch);
      start();
    },
    async shutdown() {
      closed = true;
      while (worker) await worker;
    },
  };
}
