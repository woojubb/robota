import { createOtlpPromptRootTraces } from './otlp-prompt-root-traces.js';

import type { IPromptRootTraceCoverage } from './otlp-prompt-root-traces.js';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

type TEventName =
  | 'agent.prompt_execution.completed'
  | 'agent.provider_call.completed'
  | 'agent.tool_body.completed';

interface IOtlpLogRecord {
  readonly timeUnixNano: string;
  readonly observedTimeUnixNano: string;
  readonly severityNumber: 9 | 13 | 17;
  readonly severityText: 'INFO' | 'WARN' | 'ERROR';
  readonly eventName: TEventName;
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes: readonly {
    readonly key: string;
    readonly value: { readonly stringValue: string };
  }[];
}

export interface IOtlpPromptEvents {
  readonly resourceLogs: readonly {
    readonly resource: {
      readonly attributes: readonly {
        readonly key: string;
        readonly value: { readonly stringValue: string };
      }[];
    };
    readonly scopeLogs: readonly {
      readonly scope: { readonly name: string };
      readonly logRecords: readonly IOtlpLogRecord[];
    }[];
  }[];
}

const MAX_UINT64 = (1n << 64n) - 1n;

function observedUnixNano(observedAt: Date): string {
  const millis = observedAt.getTime();
  if (!Number.isSafeInteger(millis) || millis < 0) {
    throw new RangeError('OTLP log observation time must be a valid post-epoch date.');
  }
  const nanos = BigInt(millis) * 1_000_000n;
  if (nanos > MAX_UINT64) throw new RangeError('OTLP log observation time is out of range.');
  return String(nanos);
}

/** Explicit local OTLP log projection of canonical prompt completion events. */
export function createOtlpPromptEvents(
  records: readonly IInteractiveSessionRecord[],
  version: string,
  observedAt: Date,
  serviceName: string,
): {
  readonly exported: number;
  readonly coverage: IPromptRootTraceCoverage;
  readonly payload: IOtlpPromptEvents;
} {
  const traces = createOtlpPromptRootTraces(records, version, serviceName);
  const spans = traces.payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
  if (spans.length === 0) {
    return { exported: 0, coverage: traces.coverage, payload: { resourceLogs: [] } };
  }
  const observedTimeUnixNano = observedUnixNano(observedAt);
  const logRecords: IOtlpLogRecord[] = spans.map((span) => {
    const outcomeAttribute = span.attributes.find((attribute) =>
      attribute.key === 'agent.prompt.outcome' ||
      attribute.key === 'agent.provider.outcome' ||
      attribute.key === 'agent.tool.outcome');
    const eventName: TEventName =
      span.name === 'agent.prompt_execution'
        ? 'agent.prompt_execution.completed'
        : span.name === 'agent.provider_call'
          ? 'agent.provider_call.completed'
          : 'agent.tool_body.completed';
    const severityNumber = span.status.code === 1 ? 9 : span.status.code === 2 ? 17 : 13;
    const severityText = severityNumber === 9 ? 'INFO' : severityNumber === 17 ? 'ERROR' : 'WARN';
    return {
      timeUnixNano: span.endTimeUnixNano,
      observedTimeUnixNano,
      severityNumber,
      severityText,
      eventName,
      traceId: span.traceId,
      spanId: span.spanId,
      attributes: outcomeAttribute && 'stringValue' in outcomeAttribute.value
        ? [{ key: outcomeAttribute.key, value: { stringValue: outcomeAttribute.value.stringValue } }]
        : [],
    };
  });
  return {
    exported: logRecords.length,
    coverage: traces.coverage,
    payload: {
      resourceLogs: [
        {
          resource: traces.payload.resourceSpans[0]!.resource,
          scopeLogs: [
            {
              scope: { name: '@robota-sdk/agent-session-analytics' },
              logRecords,
            },
          ],
        },
      ],
    },
  };
}
