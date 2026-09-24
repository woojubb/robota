import { ROOT_CONTEXT, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { ILivePromptTracePort } from '@robota-sdk/agent-framework';
import { createNodeOtlpLiveMetricPort } from './live-metric-otlp.js';
import { createNodeOtlpLiveLogPort } from './live-log-otlp.js';
import { createNodeLiveConsolePort } from './live-console.js';
import { createLiveTelemetryResource, safeLiveProviderRequestId, safeLiveToolCallId } from './live-resource.js';
import type { ILiveTelemetryHostResource, ILiveTelemetryResource } from './live-resource.js';

const MAX_PENDING_BATCHES = 8;

export interface INodeOtlpLiveTracePort extends ILivePromptTracePort {
  /** Drain accepted batches before the process exits. No batch is retried after a failed export. */
  shutdown(): Promise<void>;
}

export interface INodeOtlpLiveTraceOptions {
  /** Exact OTLP HTTP/protobuf traces URL, resolved by the product host. */
  endpoint: string;
  onFailure?: (code: 'projection-failed' | 'enqueue-failed' | 'delivery-failed') => void;
  resource?: ILiveTelemetryResource;
}

type TOtlpSignal = 'traces' | 'metrics' | 'logs';

const SUPPORTED_SETTINGS = new Set([
  'ENABLED', 'TRACES', 'METRICS', 'LOGS', 'OTLP_PROTOCOL', 'OTLP_ENDPOINT',
  'OTLP_TRACES_ENDPOINT', 'OTLP_METRICS_ENDPOINT', 'OTLP_LOGS_ENDPOINT',
].map((suffix) => `ROBOTA_TELEMETRY_${suffix}`));

/**
 * An enabled exporter never silently drops a setting the user expected to take effect: exporting
 * without the auth, client certificate, lock or content choice they asked for is worse than not
 * starting. The error names the setting only, because its value may be a credential.
 */
function rejectUnsupportedSettings(env: Readonly<Record<string, string | undefined>>): void {
  for (const name of Object.keys(env)) {
    if (!name.startsWith('ROBOTA_TELEMETRY_') || SUPPORTED_SETTINGS.has(name) || env[name] === undefined) continue;
    if (/HEADERS/u.test(name)) throw new Error(`Robota telemetry headers are not supported (${name}); refusing to export without them.`);
    if (/CERTIFICATE|CLIENT_KEY|(^|_)CA(_|$)|MTLS/u.test(name)) {
      throw new Error(`Robota telemetry client certificates and custom CAs are not supported (${name}); refusing to export without them.`);
    }
    if (/LOCK|MANAGED/u.test(name)) throw new Error(`A Robota telemetry managed destination lock cannot be enforced (${name}); refusing to start telemetry.`);
    if (/PROMPT|RESPONSE|CONTENT|BODY|ARGUMENT|OUTPUT/u.test(name)) {
      throw new Error(`Robota telemetry content capture is not supported (${name}); exports stay content-free.`);
    }
    throw new Error(`Unknown Robota telemetry setting ${name}.`);
  }
}

/** Product-owned config: every signal is selected independently; ambient OTEL_* is ignored. */
function resolveNodeOtlpLiveSignalEndpoint(
  env: Readonly<Record<string, string | undefined>>,
  signal: TOtlpSignal,
): string | undefined {
  const enabled = env['ROBOTA_TELEMETRY_ENABLED'];
  if (enabled === undefined || enabled === '0') return undefined;
  if (enabled !== '1') throw new Error('Invalid Robota telemetry enable switch.');
  rejectUnsupportedSettings(env);
  const label = signal === 'traces' ? 'trace' : signal === 'metrics' ? 'metric' : 'log';
  const selector = env[`ROBOTA_TELEMETRY_${signal.toUpperCase()}`];
  if (selector === undefined || selector === 'off') return undefined;
  if (selector === 'console') return undefined;
  if (selector !== 'otlp') throw new Error(`Unsupported Robota ${label} exporter.`);
  if (env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] !== 'http/protobuf') {
    throw new Error(`Robota ${label} export requires explicit http/protobuf protocol.`);
  }
  const exact = env[`ROBOTA_TELEMETRY_OTLP_${signal.toUpperCase()}_ENDPOINT`];
  const input = exact ?? env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'];
  if (!input || input.length > 2048) throw new Error(`Invalid Robota ${label} destination.`);
  try {
    const url = new URL(input);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    const namedSignalPath = /\/v1\/(traces|metrics|logs)\/?$/u.exec(url.pathname)?.[1];
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash ||
      (namedSignalPath !== undefined && (exact === undefined || namedSignalPath !== signal))) {
      throw new Error('Invalid destination.');
    }
    if (exact === undefined) url.pathname = `${url.pathname.replace(/\/$/u, '')}/v1/${signal}`;
    return url.toString();
  } catch {
    throw new Error(`Invalid Robota ${label} destination.`);
  }
}

export function resolveNodeOtlpLiveTraceEndpoint(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined { return resolveNodeOtlpLiveSignalEndpoint(env, 'traces'); }

export function resolveNodeOtlpLiveMetricEndpoint(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined { return resolveNodeOtlpLiveSignalEndpoint(env, 'metrics'); }

export function resolveNodeOtlpLiveLogEndpoint(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined { return resolveNodeOtlpLiveSignalEndpoint(env, 'logs'); }

function reportFailure(options: INodeOtlpLiveTraceOptions, code: 'delivery-failed'): void {
  try {
    void Promise.resolve(options.onFailure?.(code)).catch(() => undefined);
  } catch {
    // Diagnostics must not create an unhandled rejection or affect the turn.
  }
}

type TSpannedChild = Exclude<ILivePromptTraceBatch['children'][number], { readonly kind: 'permission' }>;

/** A permission decision is content-free but has no duration of its own — it never gets a span. */
function hasSpan(child: ILivePromptTraceBatch['children'][number]): child is TSpannedChild {
  return child.kind !== 'permission';
}

async function sendBatch(batch: ILivePromptTraceBatch, endpoint: string, resource: ILiveTelemetryResource): Promise<void> {
  const exporter: SpanExporter = {
    export(spans: ReadableSpan[], callback) {
      void (async () => {
        const body = ProtobufTraceSerializer.serializeRequest(spans);
        if (!body) throw new Error('Could not encode OTLP traces.');
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-protobuf' },
          body: Buffer.from(body),
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (response.status !== 200) throw new Error('OTLP collector rejected traces.');
        if (!response.headers.get('content-type')?.startsWith('application/x-protobuf')) {
          throw new Error('OTLP collector returned the wrong response type.');
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        if (response.body) {
          for await (const chunk of response.body) {
            length += chunk.byteLength;
            if (length > 65_536) throw new Error('OTLP response exceeded the size limit.');
            chunks.push(chunk);
          }
        }
        if (length > 0) {
          const decoded = ProtobufTraceSerializer.deserializeResponse(Buffer.concat(chunks));
          if ((decoded.partialSuccess?.rejectedSpans ?? 0) > 0) {
            throw new Error('OTLP collector partially rejected traces.');
          }
        }
      })().then(
        () => callback({ code: ExportResultCode.SUCCESS }),
        (error: unknown) => callback({ code: ExportResultCode.FAILED, error: error instanceof Error ? error : new Error('OTLP export failed.') }),
      );
    },
    async shutdown() { /* no ambient SDK exporter or background network state */ },
  };
  const ids = [batch.root.spanId, ...batch.children.filter(hasSpan).map((child) => child.trace.spanId)];
  const provider = new TracerProvider({
    resource: resourceFromAttributes(resource.attributes),
    idGenerator: {
      generateTraceId: () => batch.root.traceId,
      generateSpanId: () => {
        const id = ids.shift();
        if (!id) throw new Error('Live trace span identity exhausted.');
        return id;
      },
    },
    spanProcessors: [new BatchSpanProcessor({
      exporter,
      maxQueueSize: 258,
      maxExportBatchSize: 258,
      scheduledDelayMillis: 60_000,
      exportTimeoutMillis: 5000,
    })],
  });
  try {
    const tracer = provider.getTracer('robota.live-prompt-trace', '1');
    const root = tracer.startSpan('robota.prompt_execution', {
      kind: SpanKind.INTERNAL,
      startTime: new Date(batch.root.startedAt),
      attributes: {
        'robota.session.id': batch.sessionId,
        'robota.turn.id': batch.turnId,
        'robota.outcome': batch.root.outcome,
        'robota.omitted.provider_count': batch.omittedChildren.provider,
        'robota.omitted.tool_count': batch.omittedChildren.tool,
        'robota.omitted.permission_count': batch.omittedChildren.permission,
      },
    }, ROOT_CONTEXT);
    const parent = trace.setSpan(ROOT_CONTEXT, root);
    for (const child of batch.children.filter(hasSpan)) {
      const toolCallId = child.kind === 'tool' ? safeLiveToolCallId(child.trace.toolCallId) : undefined;
      const providerRequestId = child.kind === 'provider'
        ? safeLiveProviderRequestId(child.trace.providerRequestId) : undefined;
      const span = tracer.startSpan(child.kind === 'provider' ? 'robota.provider_call' : 'robota.tool_body', {
        kind: SpanKind.INTERNAL,
        startTime: new Date(child.trace.startedAt),
        attributes: child.kind === 'provider' ? {
          'robota.outcome': child.trace.outcome,
          'robota.provider.round': child.trace.round,
          ...(child.trace.disposition ? { 'robota.provider.disposition': child.trace.disposition } : {}),
          ...(child.trace.providerId ? { 'robota.provider.id': child.trace.providerId } : {}),
          ...(child.trace.modelId ? { 'robota.model.id': child.trace.modelId } : {}),
          ...(child.trace.usageProvenance ? { 'robota.usage.provenance': child.trace.usageProvenance } : {}),
          ...(child.trace.usageProvenance === 'complete' ? {
            'robota.usage.input_tokens': child.trace.promptTokens ?? 0,
            'robota.usage.output_tokens': child.trace.completionTokens ?? 0,
            'robota.usage.total_tokens': child.trace.totalTokens ?? 0,
          } : {}),
          ...(providerRequestId ? { 'robota.provider.request_id': providerRequestId } : {}),
        } : {
          'robota.outcome': child.trace.outcome,
          ...(toolCallId ? { 'robota.tool.call_id': toolCallId } : {}),
        },
      }, parent);
      if (child.trace.outcome === 'failure') span.setStatus({ code: SpanStatusCode.ERROR });
      span.end(new Date(child.trace.endedAt));
    }
    if (batch.root.outcome === 'failure') root.setStatus({ code: SpanStatusCode.ERROR });
    root.end(new Date(batch.root.endedAt));
    await provider.forceFlush({ timeoutMillis: 5000 });
  } finally {
    await provider.shutdown();
  }
}

/** Node-only host adapter; framework turns never wait for the network. */
export function createNodeOtlpLiveTracePort(options: INodeOtlpLiveTraceOptions): INodeOtlpLiveTracePort {
  const resource = options.resource ?? createLiveTelemetryResource();
  const pending: ILivePromptTraceBatch[] = [];
  let worker: Promise<void> | undefined;
  let closed = false;
  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      const batch = pending.shift()!;
      try {
        await sendBatch(batch, options.endpoint, resource);
      } catch {
        // A failing destination must not make process exit retry every queued turn serially.
        pending.length = 0;
        reportFailure(options, 'delivery-failed');
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
    enqueue(batch) {
      if (closed || pending.length >= MAX_PENDING_BATCHES) throw new Error('Live trace queue unavailable.');
      pending.push(batch);
      start();
    },
    ...(options.onFailure ? { onFailure: options.onFailure } : {}),
    async shutdown() {
      closed = true;
      while (worker) await worker;
    },
  };
}

/** The CLI's explicit config-to-runtime boundary, shared by every Node presentation. */
export function createConfiguredNodeOtlpLiveTelemetryPort(
  env: Readonly<Record<string, string | undefined>>,
  onFailure?: INodeOtlpLiveTraceOptions['onFailure'],
  writeConsole: (line: string) => void | Promise<void> = (line) => new Promise<void>((resolve, reject) => {
    process.stderr.write(line, (error) => error ? reject(error) : resolve());
  }),
  hostResource?: ILiveTelemetryHostResource,
): INodeOtlpLiveTracePort | undefined {
  const traceEndpoint = resolveNodeOtlpLiveTraceEndpoint(env);
  const metricEndpoint = resolveNodeOtlpLiveMetricEndpoint(env);
  const logEndpoint = resolveNodeOtlpLiveLogEndpoint(env);
  const hasConsole = env['ROBOTA_TELEMETRY_ENABLED'] === '1' &&
    ['traces', 'metrics', 'logs'].some((signal) => env[`ROBOTA_TELEMETRY_${signal.toUpperCase()}`] === 'console');
  if (!traceEndpoint && !metricEndpoint && !logEndpoint && !hasConsole) return undefined;
  const resource = createLiveTelemetryResource(hostResource);
  const ports: INodeOtlpLiveTracePort[] = [];
  if (traceEndpoint) ports.push(createNodeOtlpLiveTracePort({
    endpoint: traceEndpoint, resource, ...(onFailure ? { onFailure } : {}),
  }));
  if (metricEndpoint) ports.push(createNodeOtlpLiveMetricPort(metricEndpoint, onFailure, resource));
  if (logEndpoint) ports.push(createNodeOtlpLiveLogPort(logEndpoint, onFailure, resource));
  if (env['ROBOTA_TELEMETRY_ENABLED'] === '1') {
    for (const signal of ['traces', 'metrics', 'logs'] as const) {
      if (env[`ROBOTA_TELEMETRY_${signal.toUpperCase()}`] === 'console') {
        ports.push(createNodeLiveConsolePort(signal, writeConsole, onFailure, resource));
      }
    }
  }
  if (ports.length === 1) return ports[0];
  return {
    enqueue(batch) {
      for (const port of ports) {
        try { port.enqueue(batch); }
        catch {
          try { void Promise.resolve(onFailure?.('enqueue-failed')).catch(() => undefined); }
          catch { /* diagnostics are isolated */ }
        }
      }
    },
    async shutdown() { await Promise.all(ports.map((port) => port.shutdown())); },
  };
}
