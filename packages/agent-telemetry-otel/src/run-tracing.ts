import { ROOT_CONTEXT, SpanKind, SpanStatusCode, isSpanContextValid, trace } from '@opentelemetry/api';
import {
  AbstractPlugin,
  PROVIDER_CALL_EVENTS,
  PluginCategory,
  PluginPriority,
  spanIdFromMintedId,
} from '@robota-sdk/agent-core';

import { projectTraceChild } from './projection.js';

import type { IStructuralIdGenerator } from './span-ids.js';
import type { IOtelSpanProjection, TOtelProjectionMode, TSpannedChild } from './projection.js';
import type { SpanContext, Tracer } from '@opentelemetry/api';
import type {
  IRunTraceContext,
  IToolExecutionContext,
  IToolExecutionResult,
  TExecutionEventCallback,
  TSubprocessTraceClass,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { IProviderCallTraceEntry } from '@robota-sdk/agent-interface-analytics';

export interface IOtelTracingOptions {
  /** The host's tracer; spans are recorded on it and never exported by this package. */
  readonly tracer: Tracer;
  readonly mode: TOtelProjectionMode;
  /**
   * The generator the host gave its `TracerProvider`. With it, each span carries the ID Robota sent
   * in `traceparent`; without it, spans get the provider's own IDs and only the trace and parent match.
   */
  readonly idGenerator?: IStructuralIdGenerator;
}

export interface IOtelRunPropagation {
  /** Exact origins that may receive `traceparent` from provider calls and tool bodies. */
  readonly allowedOrigins?: readonly string[];
  readonly subprocessClasses?: readonly TSubprocessTraceClass[];
  readonly onPropagationUnavailable?: (providerId: string) => void;
}

/** What one `run()` takes, plus `end()` once it has returned. */
export interface IOtelRunTracing {
  /** Absent when the parent span is not a valid, recording context: the run then traces nothing. */
  readonly traceContext?: IRunTraceContext;
  readonly onExecutionEvent: TExecutionEventCallback;
  /** Stop attributing tool bodies to this run. */
  end(): void;
}

export interface IOtelTracing {
  /** Register once in the agent's `plugins`; it records tool bodies for every traced run. */
  readonly plugin: AbstractPlugin;
  /** Trace one run under `parent`, typically the host's own `invoke_agent` span. */
  startRun(parent: SpanContext, propagation?: IOtelRunPropagation): IOtelRunTracing;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const LABEL = /^[A-Za-z0-9._:/-]{1,128}$/u;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/u;
const OUTCOMES = new Set(['success', 'failure', 'interrupted']);
const DISPOSITIONS = new Set(['invoked', 'cache-hit', 'preflight-refused']);
const PROVENANCES = new Set(['complete', 'partial', 'absent']);

type TOutcome = IProviderCallTraceEntry['outcome'];

interface IRun {
  readonly parent: SpanContext;
  readonly executionIds: Set<string>;
}

interface IPendingToolBody {
  readonly startedAtMs: number;
  readonly spanId: string;
  readonly executionId: string | undefined;
  readonly toolCallId: string | undefined;
  readonly signal: AbortSignal | undefined;
}

const text = (value: unknown, pattern: RegExp): string | undefined =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/** A provider-call child from agent-core's content-free completion event, or undefined when malformed. */
function providerChild(data: Record<string, unknown>, parent: SpanContext): TSpannedChild | undefined {
  const callId = text(data['callId'], ID);
  const spanId = callId === undefined ? undefined : spanIdFromMintedId(callId);
  if (spanId === undefined || !SPAN_ID.test(spanId) || !instant(data['startedAt']) || !instant(data['endedAt']) ||
    !OUTCOMES.has(data['outcome'] as string) || !count(data['round']) || data['round'] < 1) return undefined;
  const disposition = DISPOSITIONS.has(data['disposition'] as string)
    ? data['disposition'] as IProviderCallTraceEntry['disposition'] : undefined;
  const provenance = PROVENANCES.has(data['usageProvenance'] as string)
    ? data['usageProvenance'] as IProviderCallTraceEntry['usageProvenance'] : undefined;
  const complete = provenance === 'complete' &&
    count(data['promptTokens']) && count(data['completionTokens']) && count(data['totalTokens']);
  const providerId = text(data['providerId'], LABEL);
  const modelId = text(data['modelId'], LABEL);
  const providerRequestId = disposition === 'invoked' ? text(data['providerRequestId'], ID) : undefined;
  return {
    kind: 'provider',
    trace: {
      callId, traceId: parent.traceId, parentSpanId: parent.spanId, spanId,
      startedAt: data['startedAt'], endedAt: data['endedAt'], outcome: data['outcome'] as TOutcome,
      round: data['round'],
      ...(disposition ? { disposition } : {}),
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(provenance ? { usageProvenance: complete || provenance !== 'complete' ? provenance : 'partial' } : {}),
      ...(complete ? {
        promptTokens: data['promptTokens'] as number,
        completionTokens: data['completionTokens'] as number,
        totalTokens: data['totalTokens'] as number,
      } : {}),
      ...(providerRequestId ? { providerRequestId } : {}),
    },
  };
}

function record(tracer: Tracer, ids: IStructuralIdGenerator | undefined, parent: SpanContext,
  span: IOtelSpanProjection): void {
  const context = trace.setSpanContext(ROOT_CONTEXT, parent);
  const start = (): ReturnType<Tracer['startSpan']> => tracer.startSpan(span.name, {
    kind: span.kind === 'client' ? SpanKind.CLIENT : SpanKind.INTERNAL,
    startTime: new Date(span.startedAt),
    attributes: span.attributes,
  }, context);
  const started = ids ? ids.withSpanId(span.spanId, start) : start();
  if (span.status === 'error') started.setStatus({ code: SpanStatusCode.ERROR });
  started.end(new Date(span.endedAt));
}

function executionIdOf(context: IToolExecutionContext | undefined): string | undefined {
  return context?.ownerPath?.find((segment) => segment.type === 'execution')?.id;
}

/** Tracing must never change a run: a failure to record drops the span, never the operation. */
function guarded(observe: () => void): void {
  try {
    observe();
  } catch {
    // allow-fallback: an observer failure loses one span and leaves the run untouched.
  }
}

class OtelToolBodyPlugin extends AbstractPlugin {
  readonly name = 'OtelToolBodyPlugin';
  readonly version = '1.0.0';
  // Keyed by the call's parameters object: agent-core hands the same object to both hooks of one
  // call, and the vendor tool call ID can repeat within and across runs.
  private readonly pending = new WeakMap<TToolParameters, IPendingToolBody>();

  override category = PluginCategory.MONITORING;
  override priority: number = PluginPriority.LOW;

  constructor(private readonly onBody: (body: IPendingToolBody, toolName: string, outcome: TOutcome) => void) {
    super();
  }

  override async beforeToolCall(_toolName: string, parameters: TToolParameters,
    context?: IToolExecutionContext): Promise<void> {
    guarded(() => {
      const bodyId = text(context?.toolBodyId, ID);
      const spanId = bodyId === undefined ? undefined : spanIdFromMintedId(bodyId);
      if (spanId === undefined || !SPAN_ID.test(spanId)) return;
      this.pending.set(parameters, {
        startedAtMs: Date.now(), spanId, executionId: executionIdOf(context),
        toolCallId: text(context?.executionId, ID), signal: context?.signal,
      });
    });
  }

  override async afterToolCall(toolName: string, parameters: TToolParameters,
    result: IToolExecutionResult): Promise<void> {
    guarded(() => {
      const body = this.pending.get(parameters);
      if (!body) return;
      this.pending.delete(parameters);
      this.onBody(body, toolName, body.signal?.aborted ? 'interrupted' : result.success ? 'success' : 'failure');
    });
  }
}

/**
 * Record a Robota agent's provider calls and tool bodies as OpenTelemetry spans on the host's tracer,
 * named by `mode` exactly as {@link projectLivePromptTrace} names them.
 */
export function createOtelTracing(options: IOtelTracingOptions): IOtelTracing {
  const { tracer, mode, idGenerator } = options;
  const runs = new Map<string, IRun>();
  const plugin = new OtelToolBodyPlugin((body, toolName, outcome) => {
    const run = body.executionId === undefined ? undefined : runs.get(body.executionId);
    if (!run) return;
    const startedAt = new Date(body.startedAtMs).toISOString();
    const child: TSpannedChild = {
      kind: 'tool',
      trace: {
        traceId: run.parent.traceId, parentSpanId: run.parent.spanId, spanId: body.spanId,
        startedAt, endedAt: new Date(Math.max(Date.now(), body.startedAtMs)).toISOString(), outcome,
        ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
        ...(text(toolName, LABEL) ? { toolName } : {}),
      },
    };
    record(tracer, idGenerator, run.parent, projectTraceChild(child, run.parent.traceId, run.parent.spanId, mode));
  });
  return {
    plugin,
    startRun(parent, propagation = {}) {
      if (!isSpanContextValid(parent)) return { onExecutionEvent: () => undefined, end: () => undefined };
      const run: IRun = { parent, executionIds: new Set() };
      return {
        traceContext: {
          traceId: parent.traceId,
          parentSpanId: parent.spanId,
          allowedOrigins: [...(propagation.allowedOrigins ?? [])],
          ...(propagation.subprocessClasses ? { subprocessClasses: [...propagation.subprocessClasses] } : {}),
          ...(propagation.onPropagationUnavailable
            ? { onPropagationUnavailable: propagation.onPropagationUnavailable } : {}),
        },
        onExecutionEvent(event, data) {
          guarded(() => {
            // Every run event names its execution before any tool body of it is dispatched.
            const executionId = data['executionId'];
            if (typeof executionId === 'string' && !run.executionIds.has(executionId)) {
              run.executionIds.add(executionId);
              runs.set(executionId, run);
            }
            if (event !== PROVIDER_CALL_EVENTS.COMPLETED) return;
            const child = providerChild(data, parent);
            if (child) record(tracer, idGenerator, parent, projectTraceChild(child, parent.traceId, parent.spanId, mode));
          });
        },
        end() {
          for (const executionId of run.executionIds) if (runs.get(executionId) === run) runs.delete(executionId);
          run.executionIds.clear();
        },
      };
    },
  };
}
