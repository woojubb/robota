import type {
  ILivePromptTraceBatch,
  IProviderCallTraceEntry,
  IToolBodyTraceEntry,
  IToolPermissionDecisionEntry,
} from '@robota-sdk/agent-interface-analytics';
import { isSafeSessionId } from '@robota-sdk/agent-session';

const MAX_CHILDREN = 256;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/u;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/u;
const LABEL = /^[A-Za-z0-9._:/-]+$/u;

export interface ILivePromptTracePort {
  /** Synchronously enqueue only. The framework never waits for transport or delivery. */
  enqueue(batch: ILivePromptTraceBatch): void;
  /** A content-free diagnostic; failure of this callback is also isolated. */
  onFailure?(code: 'projection-failed' | 'enqueue-failed'): void;
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 &&
    BigInt(milliseconds) * 1_000_000n <= (1n << 64n) - 1n &&
    new Date(milliseconds).toISOString() === value;
}

function validInterval(startedAt: unknown, endedAt: unknown): startedAt is string {
  return canonicalTime(startedAt) && canonicalTime(endedAt) &&
    Date.parse(endedAt) >= Date.parse(startedAt);
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 128 &&
    LABEL.test(value) ? value : undefined;
}

function safeTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function projectProvider(trace: IProviderCallTraceEntry): IProviderCallTraceEntry | undefined {
  if (!TRACE_ID.test(trace.traceId) || !SPAN_ID.test(trace.parentSpanId) ||
    !SPAN_ID.test(trace.spanId) || !validInterval(trace.startedAt, trace.endedAt) ||
    !Number.isSafeInteger(trace.round) || trace.round < 1 ||
    (trace.outcome !== 'success' && trace.outcome !== 'failure' && trace.outcome !== 'interrupted')) return undefined;
  const complete = trace.usageProvenance === 'complete' &&
    safeTokens(trace.promptTokens) && safeTokens(trace.completionTokens) && safeTokens(trace.totalTokens);
  const usageProvenance = trace.usageProvenance === 'complete' && !complete
    ? 'partial' : trace.usageProvenance;
  const providerId = safeLabel(trace.providerId);
  const modelId = safeLabel(trace.modelId);
  const callId = typeof trace.callId === 'string' && ID.test(trace.callId) ? trace.callId : undefined;
  return {
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    spanId: trace.spanId,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    outcome: trace.outcome,
    round: trace.round,
    ...(callId !== undefined ? { callId } : {}),
    ...(trace.disposition === 'invoked' || trace.disposition === 'cache-hit' ||
      trace.disposition === 'preflight-refused' ? { disposition: trace.disposition } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(usageProvenance === 'complete' || usageProvenance === 'partial' || usageProvenance === 'absent'
      ? { usageProvenance } : {}),
    ...(complete ? {
      promptTokens: trace.promptTokens,
      completionTokens: trace.completionTokens,
      totalTokens: trace.totalTokens,
    } : {}),
  };
}

function projectTool(trace: IToolBodyTraceEntry): IToolBodyTraceEntry | undefined {
  if (!TRACE_ID.test(trace.traceId) || !SPAN_ID.test(trace.parentSpanId) ||
    !SPAN_ID.test(trace.spanId) || !validInterval(trace.startedAt, trace.endedAt) ||
    (trace.toolCallId !== undefined && (typeof trace.toolCallId !== 'string' || !ID.test(trace.toolCallId))) ||
    (trace.outcome !== 'success' && trace.outcome !== 'failure' && trace.outcome !== 'interrupted')) return undefined;
  return {
    ...(trace.toolCallId !== undefined ? { toolCallId: trace.toolCallId } : {}),
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    spanId: trace.spanId,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    outcome: trace.outcome,
  };
}

function projectPermission(value: IToolPermissionDecisionEntry): IToolPermissionDecisionEntry | undefined {
  if (!TRACE_ID.test(value.traceId) || !SPAN_ID.test(value.parentSpanId) ||
    !canonicalTime(value.decidedAt) ||
    (value.toolCallId !== undefined && (typeof value.toolCallId !== 'string' || !ID.test(value.toolCallId))) ||
    (value.decision !== 'allowed' && value.decision !== 'denied' && value.decision !== 'hook-blocked')) return undefined;
  return {
    ...(value.toolCallId !== undefined ? { toolCallId: value.toolCallId } : {}),
    traceId: value.traceId,
    parentSpanId: value.parentSpanId,
    decidedAt: value.decidedAt,
    decision: value.decision,
  };
}

/** Maintains the actual callback order while bounding the host-visible projection. */
export class LivePromptTraceAccumulator {
  private readonly children: ILivePromptTraceBatch['children'][number][] = [];
  private omittedProvider = 0;
  private omittedTool = 0;
  private omittedPermission = 0;

  addProvider(value: IProviderCallTraceEntry): void {
    const trace = projectProvider(value);
    if (!trace || this.children.length >= MAX_CHILDREN) this.omittedProvider += 1;
    else this.children.push({ kind: 'provider', trace });
  }

  addTool(value: IToolBodyTraceEntry): void {
    const trace = projectTool(value);
    if (!trace || this.children.length >= MAX_CHILDREN) this.omittedTool += 1;
    else this.children.push({ kind: 'tool', trace });
  }

  addPermission(value: IToolPermissionDecisionEntry): void {
    const decision = projectPermission(value);
    if (!decision || this.children.length >= MAX_CHILDREN) this.omittedPermission += 1;
    else this.children.push({ kind: 'permission', decision });
  }

  omit(counts: { readonly provider: number; readonly tool: number; readonly permission?: number }): void {
    this.omittedProvider += counts.provider;
    this.omittedTool += counts.tool;
    this.omittedPermission += counts.permission ?? 0;
  }

  finish(input: {
    sessionId: string;
    turnId: string;
    root: ILivePromptTraceBatch['root'];
  }): ILivePromptTraceBatch {
    if (!isSafeSessionId(input.sessionId) || !ID.test(input.turnId) ||
      !TRACE_ID.test(input.root.traceId) || !SPAN_ID.test(input.root.spanId) ||
      !validInterval(input.root.startedAt, input.root.endedAt) ||
      (input.root.outcome !== 'success' && input.root.outcome !== 'failure' &&
        input.root.outcome !== 'interrupted')) throw new Error('Invalid live prompt trace root.');
    return {
      schemaVersion: 1,
      sessionId: input.sessionId,
      turnId: input.turnId,
      root: { ...input.root },
      children: [...this.children],
      omittedChildren: {
        provider: this.omittedProvider,
        tool: this.omittedTool,
        permission: this.omittedPermission,
      },
    };
  }
}

function reportFailure(port: ILivePromptTracePort, code: 'projection-failed' | 'enqueue-failed'): void {
  try {
    void Promise.resolve(port.onFailure?.(code)).catch(() => undefined);
  } catch {
    // A diagnostic adapter must never alter turn settlement.
  }
}

export function enqueueLivePromptTrace(port: ILivePromptTracePort, batch: ILivePromptTraceBatch): void {
  try {
    // Even a function typed `void` may return a rejecting thenable at runtime.
    void Promise.resolve(port.enqueue(batch)).catch(() => reportFailure(port, 'enqueue-failed'));
  } catch {
    reportFailure(port, 'enqueue-failed');
  }
}

export function reportLivePromptTraceProjectionFailure(port: ILivePromptTracePort): void {
  reportFailure(port, 'projection-failed');
}
