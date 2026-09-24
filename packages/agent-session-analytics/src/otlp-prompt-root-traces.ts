import { calculateModelCost, MODEL_PRICES } from '@robota-sdk/agent-core';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const MAX_UINT64 = (1n << 64n) - 1n;
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/;
const ROOT_FIELDS = [
  'promptExecutionStartedAt',
  'promptExecutionEndedAt',
  'promptExecutionOutcome',
  'promptExecutionTraceId',
  'promptExecutionSpanId',
] as const;

interface ICandidate {
  readonly record: IInteractiveSessionRecord;
  readonly data: unknown;
  readonly observationKey?: string;
  readonly traceId?: string;
}

interface IOtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: 'robota.prompt_execution' | 'robota.provider_call' | 'robota.tool_body';
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly {
    readonly key: string;
    readonly value: { readonly stringValue: string } | { readonly intValue: string } | { readonly doubleValue: number };
  }[];
  readonly status: { readonly code: number };
}

export interface IOtlpPromptRootTraces {
  readonly resourceSpans: readonly {
    readonly resource: {
      readonly attributes: readonly {
        readonly key: string;
        readonly value: { readonly stringValue: string };
      }[];
    };
    readonly scopeSpans: readonly {
      readonly scope: { readonly name: string };
      readonly spans: readonly IOtlpSpan[];
    }[];
  }[];
}

export interface IPromptRootTraceCoverage {
  readonly exported: number;
  readonly missing: number;
  readonly invalid: number;
  readonly duplicate: number;
  readonly providerChildren: {
    readonly exported: number;
    readonly invalid: number;
    readonly orphaned: number;
    readonly duplicate: number;
  };
  readonly providerUsage: {
    readonly legacy: number;
    readonly invalid: number;
    readonly partial: number;
    readonly absent: number;
  };
  readonly toolChildren: {
    readonly exported: number;
    readonly invalid: number;
    readonly orphaned: number;
    readonly duplicate: number;
  };
}

export interface IAcceptedProviderCallMetrics {
  readonly invoked: number;
  readonly completeUsage: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly unknownCost: number;
  readonly exactPriceMatches: number;
  readonly familyPriceMatches: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function otlpUnixNano(value: unknown): bigint | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return undefined;
  const nanos = BigInt(date.getTime()) * 1_000_000n;
  return nanos >= 0n && nanos <= MAX_UINT64 ? nanos : undefined;
}

function rootSpan(data: Record<string, unknown>): IOtlpSpan | undefined {
  const started = otlpUnixNano(data['promptExecutionStartedAt']);
  const ended = otlpUnixNano(data['promptExecutionEndedAt']);
  const outcome = data['promptExecutionOutcome'];
  const traceId = data['promptExecutionTraceId'];
  const spanId = data['promptExecutionSpanId'];
  if (
    started === undefined ||
    ended === undefined ||
    started > ended ||
    (outcome !== 'success' && outcome !== 'failure' && outcome !== 'interrupted') ||
    typeof traceId !== 'string' ||
    !TRACE_ID.test(traceId) ||
    typeof spanId !== 'string' ||
    !SPAN_ID.test(spanId) ||
    typeof data['usageObservationId'] !== 'string' ||
    data['usageObservationId'].length === 0 ||
    data['turnId'] !== data['usageObservationId'] ||
    (data['outcome'] !== 'success' &&
      data['outcome'] !== 'failure' &&
      data['outcome'] !== 'interrupted')
  ) {
    return undefined;
  }
  return {
    traceId,
    spanId,
    name: 'robota.prompt_execution',
    kind: 1,
    startTimeUnixNano: String(started),
    endTimeUnixNano: String(ended),
    attributes: [{ key: 'robota.prompt.outcome', value: { stringValue: outcome } }],
    status: { code: outcome === 'success' ? 1 : outcome === 'failure' ? 2 : 0 },
  };
}

function childSpan(data: unknown, kind: 'provider' | 'tool'): IOtlpSpan | undefined {
  if (!isRecord(data)) return undefined;
  const traceId = data['traceId'];
  const parentSpanId = data['parentSpanId'];
  const spanId = data['spanId'];
  const started = otlpUnixNano(data['startedAt']);
  const ended = otlpUnixNano(data['endedAt']);
  const outcome = data['outcome'];
  if (
    typeof traceId !== 'string' ||
    !TRACE_ID.test(traceId) ||
    typeof parentSpanId !== 'string' ||
    !SPAN_ID.test(parentSpanId) ||
    typeof spanId !== 'string' ||
    !SPAN_ID.test(spanId) ||
    started === undefined ||
    ended === undefined ||
    started > ended ||
    (outcome !== 'success' && outcome !== 'failure' && outcome !== 'interrupted') ||
    (kind === 'provider' && (!Number.isSafeInteger(data['round']) || (data['round'] as number) < 1))
  ) {
    return undefined;
  }
  return {
    traceId,
    parentSpanId,
    spanId,
    name: kind === 'provider' ? 'robota.provider_call' : 'robota.tool_body',
    kind: 1,
    startTimeUnixNano: String(started),
    endTimeUnixNano: String(ended),
    attributes: [
      {
        key: kind === 'provider' ? 'robota.provider.outcome' : 'robota.tool.outcome',
        value: { stringValue: outcome },
      },
    ],
    status: { code: outcome === 'success' ? 1 : outcome === 'failure' ? 2 : 0 },
  };
}

function childIdentity(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const traceId = data['traceId'];
  const spanId = data['spanId'];
  return typeof traceId === 'string' &&
    TRACE_ID.test(traceId) &&
    typeof spanId === 'string' &&
    SPAN_ID.test(spanId)
    ? `${traceId}:${spanId}`
    : undefined;
}

function validToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function enrichProviderSpan(
  span: IOtlpSpan,
  data: unknown,
  usageCoverage: { legacy: number; invalid: number; partial: number; absent: number },
  metrics: { -readonly [K in keyof IAcceptedProviderCallMetrics]: number },
): IOtlpSpan {
  if (!isRecord(data) || data['disposition'] === undefined) {
    usageCoverage.legacy += 1;
    return span;
  }
  if (data['disposition'] === 'cache-hit' || data['disposition'] === 'preflight-refused') {
    if (data['promptTokens'] !== undefined || data['completionTokens'] !== undefined) usageCoverage.invalid += 1;
    return span;
  }
  if (data['disposition'] !== 'invoked') {
    usageCoverage.invalid += 1;
    return span;
  }
  metrics.invoked += 1;
  const provenance = data['usageProvenance'];
  if (provenance === 'partial') {
    usageCoverage.partial += 1;
    metrics.unknownCost += 1;
    return span;
  }
  if (provenance === 'absent' || provenance === undefined) {
    usageCoverage.absent += 1;
    metrics.unknownCost += 1;
    return span;
  }
  const input = data['promptTokens'];
  const output = data['completionTokens'];
  const total = data['totalTokens'];
  if (
    provenance !== 'complete' || !validToken(input) || !validToken(output) ||
    !Number.isSafeInteger(input + output) || total !== input + output
  ) {
    usageCoverage.invalid += 1;
    metrics.unknownCost += 1;
    return span;
  }
  metrics.completeUsage += 1;
  metrics.inputTokens += input;
  metrics.outputTokens += output;
  const attrs: IOtlpSpan['attributes'][number][] = [
    ...span.attributes,
    { key: 'robota.provider.usage.input_tokens', value: { intValue: String(input) } },
    { key: 'robota.provider.usage.output_tokens', value: { intValue: String(output) } },
  ];
  const model = data['modelId'];
  const estimated = typeof model === 'string' && model.length > 0 && model.length <= 128 &&
    [...model].every((char) => char.charCodeAt(0) >= 32)
    ? calculateModelCost(model, input, output) : undefined;
  if (estimated === undefined || !Number.isFinite(estimated) || estimated < 0) {
    metrics.unknownCost += 1;
  } else {
    metrics.estimatedCostUsd += estimated;
    if (typeof model === 'string' && Object.hasOwn(MODEL_PRICES, model)) metrics.exactPriceMatches += 1;
    else metrics.familyPriceMatches += 1;
    attrs.push({ key: 'robota.provider.cost.usd.estimated', value: { doubleValue: estimated } });
  }
  return { ...span, attributes: attrs };
}

/** Project only proven canonical prompt roots; never infer spans from legacy usage or tool events. */
export function createOtlpPromptRootTraces(
  records: readonly IInteractiveSessionRecord[],
  version: string,
): { readonly payload: IOtlpPromptRootTraces; readonly coverage: IPromptRootTraceCoverage; readonly callMetrics: IAcceptedProviderCallMetrics } {
  const candidates: ICandidate[] = [];
  const observationCounts = new Map<string, number>();
  const traceCounts = new Map<string, number>();
  for (const record of records) {
    for (const entry of record.history ?? []) {
      if (entry.type !== 'usage-observation') continue;
      const data: unknown = entry.data;
      const observationId = isRecord(data) ? data['usageObservationId'] : undefined;
      const traceId = isRecord(data) ? data['promptExecutionTraceId'] : undefined;
      const observationKey =
        typeof observationId === 'string' && observationId.length > 0
          ? JSON.stringify([record.id, observationId])
          : undefined;
      const validTraceId =
        typeof traceId === 'string' && TRACE_ID.test(traceId) ? traceId : undefined;
      if (observationKey) count(observationCounts, observationKey);
      if (validTraceId) count(traceCounts, validTraceId);
      candidates.push({ record, data, observationKey, traceId: validTraceId });
    }
  }

  const spans: IOtlpSpan[] = [];
  const rootsByRecord = new Map<IInteractiveSessionRecord, Map<string, IOtlpSpan>>();
  let missing = 0;
  let invalid = 0;
  let duplicate = 0;
  for (const candidate of candidates) {
    if (
      (candidate.observationKey && (observationCounts.get(candidate.observationKey) ?? 0) > 1) ||
      (candidate.traceId && (traceCounts.get(candidate.traceId) ?? 0) > 1)
    ) {
      duplicate += 1;
      continue;
    }
    const data = candidate.data;
    if (!isRecord(data)) {
      invalid += 1;
      continue;
    }
    if (ROOT_FIELDS.every((field) => data[field] === undefined)) {
      missing += 1;
      continue;
    }
    const span = rootSpan(data);
    if (!span) {
      invalid += 1;
      continue;
    }
    spans.push(span);
    const recordRoots = rootsByRecord.get(candidate.record) ?? new Map<string, IOtlpSpan>();
    recordRoots.set(span.traceId, span);
    rootsByRecord.set(candidate.record, recordRoots);
  }

  const children: {
    readonly record: IInteractiveSessionRecord;
    readonly span: IOtlpSpan | undefined;
    readonly identity: string | undefined;
    readonly kind: 'provider' | 'tool';
    readonly data: unknown;
  }[] = [];
  const childCounts = new Map<string, number>();
  for (const record of records) {
    for (const entry of record.history ?? []) {
      const kind =
        entry.type === 'provider-call-trace'
          ? 'provider'
          : entry.type === 'tool-body-trace'
            ? 'tool'
            : undefined;
      if (!kind) continue;
      const identity = childIdentity(entry.data);
      const span = childSpan(entry.data, kind);
      if (identity) count(childCounts, identity);
      children.push({ record, span, identity, kind, data: entry.data });
    }
  }
  const coverageByKind = {
    provider: { exported: 0, invalid: 0, orphaned: 0, duplicate: 0 },
    tool: { exported: 0, invalid: 0, orphaned: 0, duplicate: 0 },
  };
  const providerUsage = { legacy: 0, invalid: 0, partial: 0, absent: 0 };
  const callMetrics = {
    invoked: 0, completeUsage: 0, inputTokens: 0, outputTokens: 0,
    estimatedCostUsd: 0, unknownCost: 0, exactPriceMatches: 0, familyPriceMatches: 0,
  };
  for (const child of children) {
    const { span } = child;
    const coverage = coverageByKind[child.kind];
    if (child.identity && (childCounts.get(child.identity) ?? 0) > 1) {
      coverage.duplicate += 1;
      continue;
    }
    if (!span) {
      coverage.invalid += 1;
      continue;
    }
    const root = rootsByRecord.get(child.record)?.get(span.traceId);
    if (!root || span.parentSpanId !== root.spanId || span.spanId === root.spanId) {
      coverage.orphaned += 1;
      continue;
    }
    if (
      BigInt(span.startTimeUnixNano) < BigInt(root.startTimeUnixNano) ||
      BigInt(span.endTimeUnixNano) > BigInt(root.endTimeUnixNano)
    ) {
      coverage.invalid += 1;
      continue;
    }
    spans.push(child.kind === 'provider'
      ? enrichProviderSpan(span, child.data, providerUsage, callMetrics)
      : span);
    coverage.exported += 1;
  }

  return {
    payload: {
      resourceSpans: spans.length
        ? [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'robota' } },
                  { key: 'service.version', value: { stringValue: version } },
                ],
              },
              scopeSpans: [{ scope: { name: '@robota-sdk/agent-session-analytics' }, spans }],
            },
          ]
        : [],
    },
    coverage: {
      exported: spans.length - coverageByKind.provider.exported - coverageByKind.tool.exported,
      missing,
      invalid,
      duplicate,
      providerChildren: coverageByKind.provider,
      providerUsage,
      toolChildren: coverageByKind.tool,
    },
    callMetrics,
  };
}
