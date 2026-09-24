import { ROOT_CONTEXT, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { ILivePromptTracePort } from '@robota-sdk/agent-framework';
import { createNodeOtlpLiveMetricPort } from './live-metric-otlp.js';
import type { TLiveMetricAttribute } from './live-metric-otlp.js';
import { createNodeOtlpLiveLogPort } from './live-log-otlp.js';
import { createNodeLiveConsolePort } from './live-console.js';
import { createNodeOtlpLiveContentPort } from './live-content-otlp.js';
import type { INodeOtlpLiveContentPort } from './live-content-otlp.js';
import type { ILiveContentRedactionContext } from './live-content-redaction.js';
import { LIVE_CONTENT_SETTINGS, resolveLiveContentPolicy } from './live-content-settings.js';
import { createLiveTelemetryResource, safeLiveProviderRequestId, safeLiveToolCallId } from './live-resource.js';
import {
  buildOtlpRequestHeaders, mergeOtlpHeaderMaps, otlpProtobufRequestHeaders, parseOtlpHeaderSetting,
} from './live-otlp-headers.js';
import type { TOtlpHeaderMap } from './live-otlp-headers.js';
import type { ILiveTelemetryHostResource, ILiveTelemetryResource } from './live-resource.js';

const MAX_PENDING_BATCHES = 8;

export interface INodeOtlpLiveTracePort extends ILivePromptTracePort {
  /** Drain accepted batches before the process exits. No batch is retried after a failed export. */
  shutdown(): Promise<void>;
}

export interface INodeOtlpLiveTraceOptions {
  /** Exact OTLP HTTP/protobuf traces URL, resolved by the product host. */
  endpoint: string;
  /** Static headers prebuilt at startup; the sender's own content type always overrides them. */
  headers?: Headers;
  onFailure?: (code: TLiveTelemetryFailureCode) => void;
  resource?: ILiveTelemetryResource;
}

type TOtlpSignal = 'traces' | 'metrics' | 'logs';

/** Content-free diagnostics; `content-delivery-failed` is the separate content channel's own scope. */
export type TLiveTelemetryFailureCode =
  | 'projection-failed' | 'enqueue-failed' | 'delivery-failed' | 'content-delivery-failed';

const SUPPORTED_SETTINGS = new Set([
  'ENABLED', 'TRACES', 'METRICS', 'LOGS', 'OTLP_PROTOCOL', 'OTLP_ENDPOINT',
  'OTLP_TRACES_ENDPOINT', 'OTLP_METRICS_ENDPOINT', 'OTLP_LOGS_ENDPOINT',
  'OTLP_HEADERS', 'OTLP_TRACES_HEADERS', 'OTLP_METRICS_HEADERS', 'OTLP_LOGS_HEADERS',
  'METRIC_ATTRIBUTES', 'PROPAGATE_TO',
].map((suffix) => `ROBOTA_TELEMETRY_${suffix}`).concat(LIVE_CONTENT_SETTINGS));

const METRIC_ATTRIBUTES_SETTING = 'ROBOTA_TELEMETRY_METRIC_ATTRIBUTES';
const METRIC_ATTRIBUTE_TOKENS: ReadonlySet<TLiveMetricAttribute> = new Set(['session', 'provider', 'model']);

/**
 * Metric attribute cardinality is opt-in and only meaningful when metrics are actually exported:
 * the setting is refused rather than silently unused when metrics stay off. A malformed token is
 * named only by its 1-based position, never by its text, since the text may be something the
 * caller did not mean to disclose.
 */
function resolveMetricAttributesSetting(
  env: Readonly<Record<string, string | undefined>>,
): ReadonlySet<TLiveMetricAttribute> {
  const raw = env[METRIC_ATTRIBUTES_SETTING];
  if (raw === undefined) return new Set();
  const selector = env['ROBOTA_TELEMETRY_METRICS'];
  if (selector !== 'otlp' && selector !== 'console') {
    throw new Error(`${METRIC_ATTRIBUTES_SETTING} is set but metrics are not exported over otlp or console.`);
  }
  const result = new Set<TLiveMetricAttribute>();
  raw.split(',').forEach((token, index) => {
    if (!(METRIC_ATTRIBUTE_TOKENS as ReadonlySet<string>).has(token) || result.has(token as TLiveMetricAttribute)) {
      throw new Error(`${METRIC_ATTRIBUTES_SETTING} has an invalid token at position ${index + 1}.`);
    }
    result.add(token as TLiveMetricAttribute);
  });
  return result;
}

const PROPAGATE_TO_SETTING = 'ROBOTA_TELEMETRY_PROPAGATE_TO';
const MAX_PROPAGATION_ORIGINS = 16;
const MAX_PROPAGATION_ORIGIN_LENGTH = 256;

/** The trust a host hands the framework: exact origins that may receive `traceparent`. */
export interface ILiveTraceContextPropagation {
  readonly allowedOrigins: readonly string[];
}

/**
 * Trace-context propagation discloses the operator's trace identifiers to a third party, so it is
 * an explicit allowlist of exact origins and exists only while traces are actually exported. Each
 * entry must already be its own origin — no path, trailing slash, userinfo, wildcard or default
 * port spelled out — so what the operator wrote is exactly what is compared. Errors name the
 * setting and a 1-based position only, never the value.
 */
function resolvePropagateToSetting(
  env: Readonly<Record<string, string | undefined>>,
): ILiveTraceContextPropagation | undefined {
  const raw = env[PROPAGATE_TO_SETTING];
  if (raw === undefined) return undefined;
  const traces = env['ROBOTA_TELEMETRY_TRACES'];
  if (traces !== 'otlp' && traces !== 'console') {
    throw new Error(`${PROPAGATE_TO_SETTING} is set but traces are not exported over otlp or console.`);
  }
  const entries = raw.split(',');
  if (entries.length > MAX_PROPAGATION_ORIGINS) throw new Error(`${PROPAGATE_TO_SETTING} lists too many origins.`);
  const allowedOrigins: string[] = [];
  entries.forEach((entry, index) => {
    if (!isExactTrustedOrigin(entry)) {
      throw new Error(`${PROPAGATE_TO_SETTING} has an invalid origin at position ${index + 1}.`);
    }
    if (allowedOrigins.includes(entry)) {
      throw new Error(`${PROPAGATE_TO_SETTING} has a duplicate origin at position ${index + 1}.`);
    }
    allowedOrigins.push(entry);
  });
  return Object.freeze({ allowedOrigins: Object.freeze(allowedOrigins) });
}

function isExactTrustedOrigin(entry: string): boolean {
  if (entry.length === 0 || entry.length > MAX_PROPAGATION_ORIGIN_LENGTH || entry.includes('*')) return false;
  try {
    const url = new URL(entry);
    if (url.origin !== entry) return false;
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
  } catch {
    return false;
  }
}

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
    if (/PROMPT|RESPONSE|CONTENT|BOD(?:Y|IES)|ARGUMENT|OUTPUT/u.test(name)) {
      throw new Error(`Robota telemetry content capture is not supported (${name}); exports stay content-free.`);
    }
    throw new Error(`Unknown Robota telemetry setting ${name}.`);
  }
}

interface IResolvedOtlpSignal {
  readonly endpoint: string;
  /** Decided by which setting supplied the destination, never by comparing URLs. */
  readonly usesGenericEndpoint: boolean;
}

/** Product-owned config: every signal is selected independently; ambient OTEL_* is ignored. */
function resolveNodeOtlpLiveSignal(
  env: Readonly<Record<string, string | undefined>>,
  signal: TOtlpSignal,
): IResolvedOtlpSignal | undefined {
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
    return { endpoint: url.toString(), usesGenericEndpoint: exact === undefined };
  } catch {
    throw new Error(`Invalid Robota ${label} destination.`);
  }
}

function resolveNodeOtlpLiveSignalEndpoint(
  env: Readonly<Record<string, string | undefined>>,
  signal: TOtlpSignal,
): string | undefined { return resolveNodeOtlpLiveSignal(env, signal)?.endpoint; }

const OTLP_SIGNALS = ['traces', 'metrics', 'logs'] as const;
const GENERIC_HEADERS = 'ROBOTA_TELEMETRY_OTLP_HEADERS';
const signalHeadersVariable = (signal: TOtlpSignal): string => `ROBOTA_TELEMETRY_OTLP_${signal.toUpperCase()}_HEADERS`;

interface IOtlpDestination {
  readonly endpoint: string;
  readonly headers: Headers;
}

/**
 * Credentials are scoped to the destination they were configured for: generic headers go only to
 * signals that use the generic endpoint, and a signal with its own endpoint gets only its own
 * headers. Headers that would be silently unused, or a destination left without the credentials
 * its siblings carry, refuse startup instead.
 */
function resolveNodeOtlpLiveDestinations(
  env: Readonly<Record<string, string | undefined>>,
): Partial<Record<TOtlpSignal, IOtlpDestination>> {
  const resolved = OTLP_SIGNALS.map((signal) => [signal, resolveNodeOtlpLiveSignal(env, signal)] as const);
  const enabled = env['ROBOTA_TELEMETRY_ENABLED'];
  if (enabled === undefined || enabled === '0') return {};
  const parse = (variable: string): TOtlpHeaderMap | undefined => {
    const raw = env[variable];
    return raw === undefined ? undefined : parseOtlpHeaderSetting(variable, raw);
  };
  const generic = parse(GENERIC_HEADERS);
  const own = new Map(OTLP_SIGNALS.map((signal) => [signal, parse(signalHeadersVariable(signal))] as const));
  for (const [signal, destination] of resolved) {
    if (own.get(signal) !== undefined && destination === undefined) {
      throw new Error(`${signalHeadersVariable(signal)} is set but that signal does not export over OTLP.`);
    }
  }
  const genericUsers = resolved.filter(([, destination]) => destination?.usesGenericEndpoint === true);
  if (generic !== undefined) {
    if (genericUsers.length === 0) {
      throw new Error(`${GENERIC_HEADERS} is set but no OTLP signal uses ROBOTA_TELEMETRY_OTLP_ENDPOINT.`);
    }
    for (const [signal, destination] of resolved) {
      if (destination && !destination.usesGenericEndpoint && own.get(signal) === undefined) {
        throw new Error(`${signalHeadersVariable(signal)} is required: that signal has its own endpoint and ` +
          `never receives ${GENERIC_HEADERS}.`);
      }
    }
  }
  const destinations: Partial<Record<TOtlpSignal, IOtlpDestination>> = {};
  for (const [signal, destination] of resolved) {
    if (!destination) continue;
    const signalHeaders = own.get(signal);
    const sources = [
      ...(destination.usesGenericEndpoint && generic ? [[GENERIC_HEADERS, generic] as const] : []),
      ...(signalHeaders ? [[signalHeadersVariable(signal), signalHeaders] as const] : []),
    ];
    const variables = sources.map(([variable]) => variable);
    const merged = mergeOtlpHeaderMaps(variables, ...sources.map(([, map]) => map));
    destinations[signal] = { endpoint: destination.endpoint, headers: buildOtlpRequestHeaders(variables, merged) };
  }
  return destinations;
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

async function sendBatch(
  batch: ILivePromptTraceBatch, endpoint: string, resource: ILiveTelemetryResource, headers: Headers | undefined,
): Promise<void> {
  const exporter: SpanExporter = {
    export(spans: ReadableSpan[], callback) {
      void (async () => {
        const body = ProtobufTraceSerializer.serializeRequest(spans);
        if (!body) throw new Error('Could not encode OTLP traces.');
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: otlpProtobufRequestHeaders(headers),
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
        await sendBatch(batch, options.endpoint, resource, options.headers);
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
  /** Where a content-free propagation diagnostic goes; only attached when propagation is configured. */
  onDiagnostic?: (message: string) => void,
  /** What content redaction needs from the host; required only when a content gate is on. */
  contentRedaction?: ILiveContentRedactionContext,
): INodeOtlpLiveTracePort | undefined {
  const destinations = resolveNodeOtlpLiveDestinations(env);
  const { traces, metrics, logs } = destinations;
  const contentPolicy = resolveLiveContentPolicy(env);
  // Content follows prompt history, which only the interactive terminal records; any other mode
  // would leave the setting silently unused, so it refuses to start instead.
  if (contentPolicy && hostResource && hostResource.surface !== 'interactive') {
    throw new Error(`Robota telemetry content capture is available only in the interactive terminal, not in ${hostResource.surface} mode.`);
  }
  const metricAttributes = env['ROBOTA_TELEMETRY_ENABLED'] === '1'
    ? resolveMetricAttributesSetting(env) : new Set<TLiveMetricAttribute>();
  const propagation = env['ROBOTA_TELEMETRY_ENABLED'] === '1' ? resolvePropagateToSetting(env) : undefined;
  const hasConsole = env['ROBOTA_TELEMETRY_ENABLED'] === '1' &&
    ['traces', 'metrics', 'logs'].some((signal) => env[`ROBOTA_TELEMETRY_${signal.toUpperCase()}`] === 'console');
  if (!traces && !metrics && !logs && !hasConsole) return undefined;
  const resource = createLiveTelemetryResource(hostResource);
  const ports: INodeOtlpLiveTracePort[] = [];
  if (traces) ports.push(createNodeOtlpLiveTracePort({
    endpoint: traces.endpoint, headers: traces.headers, resource, ...(onFailure ? { onFailure } : {}),
  }));
  if (metrics) ports.push(createNodeOtlpLiveMetricPort(metrics.endpoint, onFailure, resource, metrics.headers, metricAttributes));
  if (logs) ports.push(createNodeOtlpLiveLogPort(logs.endpoint, onFailure, resource, logs.headers));
  if (env['ROBOTA_TELEMETRY_ENABLED'] === '1') {
    for (const signal of ['traces', 'metrics', 'logs'] as const) {
      if (env[`ROBOTA_TELEMETRY_${signal.toUpperCase()}`] === 'console') {
        ports.push(createNodeLiveConsolePort(signal, writeConsole, onFailure, resource, metricAttributes));
      }
    }
  }
  const port = ports.length === 1 ? ports[0]! : combinePorts(ports, onFailure);
  let content: INodeOtlpLiveContentPort | undefined;
  if (contentPolicy) {
    // A gate on implies LOGS=otlp, so the logs destination exists; content reuses it exactly.
    if (!logs) throw new Error('Robota telemetry content capture requires ROBOTA_TELEMETRY_LOGS=otlp.');
    if (!contentRedaction) throw new Error('Robota telemetry content capture needs the host redaction context.');
    // A header value and, for an `Authorization: <scheme> <credential>` form, the credential alone.
    const headerValues = OTLP_SIGNALS.flatMap((signal) => [...(destinations[signal]?.headers.values() ?? [])])
      .flatMap((value) => [value, ...(/^[A-Za-z][\w.-]*\s+(\S.*)$/u.exec(value)?.slice(1) ?? [])]);
    content = createNodeOtlpLiveContentPort({
      endpoint: logs.endpoint,
      headers: logs.headers,
      resource,
      policy: contentPolicy,
      redaction: {
        ...contentRedaction,
        getSecrets: () => [...contentRedaction.getSecrets(), ...headerValues],
      },
      ...(onFailure ? { onFailure } : {}),
    });
  }
  if (!propagation && !content) return port;
  return {
    enqueue: (batch) => port.enqueue(batch),
    ...(port.onFailure ? { onFailure: port.onFailure } : {}),
    shutdown: async () => { await Promise.all([port.shutdown(), content?.shutdown()]); },
    ...(propagation ? { traceContextPropagation: propagation } : {}),
    ...(propagation && onDiagnostic ? { onDiagnostic } : {}),
    ...(content ? { content: { policy: content.policy, enqueue: (batch) => content.enqueue(batch) } } : {}),
  };
}

function combinePorts(
  ports: readonly INodeOtlpLiveTracePort[],
  onFailure: INodeOtlpLiveTraceOptions['onFailure'],
): INodeOtlpLiveTracePort {
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
