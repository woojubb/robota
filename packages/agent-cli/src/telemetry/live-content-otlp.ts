/**
 * Opt-in prompt, response and tool content as OTLP log records. It has its own POST, queue and failure
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
  ILivePromptContentItem,
  ILivePromptContentPolicy,
  TLivePromptContentKind,
} from '@robota-sdk/agent-interface-analytics';
import { otlpProtobufRequestHeaders } from './live-otlp-headers.js';
import { prepareLiveContentRedactor } from './live-content-redaction.js';
import type { ILiveContentRedactionContext, TLiveContentRedactor } from './live-content-redaction.js';
import { safeLiveToolCallId } from './live-resource.js';
import type { ILiveTelemetryResource } from './live-resource.js';

/** Queued batches; each holds at most one turn's bounded text, so this caps the channel's memory. */
const MAX_PENDING_BATCHES = 4;
/** Total post-redaction body bytes one request may export. */
export const LIVE_CONTENT_BATCH_BODY_BUDGET = 768 * 1024;
/** Items one request may export. */
export const LIVE_CONTENT_BATCH_MAX_ITEMS = 64;
/** Items one batch may export: a prompt, a response and the framework's tool item limit. */
export const LIVE_CONTENT_TURN_MAX_ITEMS = 2 + 128;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/u;
const TOOL_NAME = /^[A-Za-z0-9._:/-]+$/u;
const KINDS: readonly TLivePromptContentKind[] = ['user-prompt', 'assistant-response', 'tool-arguments', 'tool-output'];

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

function toolAttributes(item: ILivePromptContentItem): Record<string, string> {
  if (!item.tool) return {};
  const callId = safeLiveToolCallId(item.tool.callId);
  const name = typeof item.tool.name === 'string' && Buffer.byteLength(item.tool.name, 'utf8') <= 128 &&
    TOOL_NAME.test(item.tool.name) ? item.tool.name : 'unknown';
  const outcome = item.tool.outcome === 'success' || item.tool.outcome === 'failure' ||
    item.tool.outcome === 'denied' ? item.tool.outcome : 'failure';
  return {
    ...(callId ? { 'robota.tool.call_id': callId } : {}),
    'robota.tool.name': name,
    'robota.tool.outcome': outcome,
  };
}

/**
 * The requests one batch exports, in order: prompt, response, then tool items in call order, cut
 * into requests of at most {@link LIVE_CONTENT_BATCH_MAX_ITEMS} items and
 * {@link LIVE_CONTENT_BATCH_BODY_BUDGET} post-redaction bytes. What was dropped — here or by the
 * framework — is counted by kind in one content-free record at the end of the last request.
 * `redactor` is undefined when the batch's secrets could not be read: then nothing but that count
 * is exported.
 */
export function projectLiveContentLogs(
  batch: ILivePromptContentBatch,
  observedAt: Date,
  identity: ILiveTelemetryResource,
  policy: ILivePromptContentPolicy,
  redactor: TLiveContentRedactor | undefined,
): ReadableLogRecord[][] {
  const resource = resourceFromAttributes(identity.attributes);
  const instrumentationScope = { name: 'robota.live-prompt-content', version: '1' };
  const base = {
    hrTime: hrTime(batch.root.endedAt),
    hrTimeObserved: hrTime(observedAt.toISOString()),
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    resource, instrumentationScope, droppedAttributesCount: 0,
  };
  const spanContext = (spanId: string | undefined) => ({
    traceId: batch.root.traceId,
    spanId: spanId !== undefined && SPAN_ID.test(spanId) ? spanId : batch.root.spanId,
    traceFlags: TraceFlags.NONE,
  });
  const omitted = new Map<TLivePromptContentKind, number>();
  const omit = (kind: TLivePromptContentKind, count = 1): void => {
    if (!KINDS.includes(kind) || !Number.isSafeInteger(count) || count <= 0) return;
    omitted.set(kind, (omitted.get(kind) ?? 0) + count);
  };
  for (const kind of KINDS) omit(kind, batch.omitted?.[kind] ?? 0);
  const chunks: ReadableLogRecord[][] = [];
  let chunk: ReadableLogRecord[] = [];
  let budget = LIVE_CONTENT_BATCH_BODY_BUDGET;
  for (const [index, item] of batch.items.entries()) {
    if (!redactor || index >= LIVE_CONTENT_TURN_MAX_ITEMS) { omit(item.kind); continue; }
    let redacted: ReturnType<TLiveContentRedactor>;
    try {
      redacted = redactor(item.text, policy.maxBytes, item.truncated);
    } catch {
      omit(item.kind);
      continue;
    }
    const bytes = Buffer.byteLength(redacted.text, 'utf8');
    if (bytes > LIVE_CONTENT_BATCH_BODY_BUDGET) { omit(item.kind); continue; }
    if (chunk.length >= LIVE_CONTENT_BATCH_MAX_ITEMS || bytes > budget) {
      chunks.push(chunk);
      chunk = [];
      budget = LIVE_CONTENT_BATCH_BODY_BUDGET;
    }
    budget -= bytes;
    chunk.push({
      ...base,
      spanContext: spanContext(item.tool?.spanId),
      eventName: 'robota.content.captured',
      body: redacted.text,
      attributes: {
        'robota.content.kind': item.kind,
        'robota.content.truncated': redacted.truncated,
        'robota.content.original_bytes': item.originalBytes,
        ...(item.partial === true ? { 'robota.content.partial': true } : {}),
        ...toolAttributes(item),
      },
    });
  }
  const total = [...omitted.values()].reduce((sum, count) => sum + count, 0);
  if (total > 0) {
    chunk.push({
      ...base,
      spanContext: spanContext(undefined),
      eventName: 'robota.content.omitted',
      attributes: {
        'robota.telemetry.omitted_content_items': total,
        ...Object.fromEntries([...omitted].map(([kind, count]) =>
          [`robota.telemetry.omitted_content_items.${kind.replace(/-/gu, '_')}`, count])),
      },
    });
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
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
        // One request per chunk, in order; the first failure abandons the rest of the batch.
        for (const chunk of projectLiveContentLogs(batch, new Date(), options.resource, options.policy, redactor)) {
          await post(chunk, options.endpoint, options.headers);
        }
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
