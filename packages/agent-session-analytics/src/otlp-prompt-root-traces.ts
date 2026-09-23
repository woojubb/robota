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
  readonly name: 'robota.prompt_execution' | 'robota.provider_call';
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly {
    readonly key: string;
    readonly value: { readonly stringValue: string };
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

function providerSpan(data: unknown): IOtlpSpan | undefined {
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
    !Number.isSafeInteger(data['round']) ||
    (data['round'] as number) < 1
  ) {
    return undefined;
  }
  return {
    traceId,
    parentSpanId,
    spanId,
    name: 'robota.provider_call',
    kind: 1,
    startTimeUnixNano: String(started),
    endTimeUnixNano: String(ended),
    attributes: [{ key: 'robota.provider.outcome', value: { stringValue: outcome } }],
    status: { code: outcome === 'success' ? 1 : outcome === 'failure' ? 2 : 0 },
  };
}

function providerIdentity(data: unknown): string | undefined {
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

/** Project only proven canonical prompt roots; never infer spans from legacy usage or tool events. */
export function createOtlpPromptRootTraces(
  records: readonly IInteractiveSessionRecord[],
  version: string,
): { readonly payload: IOtlpPromptRootTraces; readonly coverage: IPromptRootTraceCoverage } {
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
  }[] = [];
  const childCounts = new Map<string, number>();
  for (const record of records) {
    for (const entry of record.history ?? []) {
      if (entry.type !== 'provider-call-trace') continue;
      const identity = providerIdentity(entry.data);
      const span = providerSpan(entry.data);
      if (identity) count(childCounts, identity);
      children.push({ record, span, identity });
    }
  }
  let childExported = 0;
  let childInvalid = 0;
  let childOrphaned = 0;
  let childDuplicate = 0;
  for (const child of children) {
    const { span } = child;
    if (child.identity && (childCounts.get(child.identity) ?? 0) > 1) {
      childDuplicate += 1;
      continue;
    }
    if (!span) {
      childInvalid += 1;
      continue;
    }
    const root = rootsByRecord.get(child.record)?.get(span.traceId);
    if (!root || span.parentSpanId !== root.spanId || span.spanId === root.spanId) {
      childOrphaned += 1;
      continue;
    }
    if (
      BigInt(span.startTimeUnixNano) < BigInt(root.startTimeUnixNano) ||
      BigInt(span.endTimeUnixNano) > BigInt(root.endTimeUnixNano)
    ) {
      childInvalid += 1;
      continue;
    }
    spans.push(span);
    childExported += 1;
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
      exported: spans.length - childExported,
      missing,
      invalid,
      duplicate,
      providerChildren: {
        exported: childExported,
        invalid: childInvalid,
        orphaned: childOrphaned,
        duplicate: childDuplicate,
      },
    },
  };
}
