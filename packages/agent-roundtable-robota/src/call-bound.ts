import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import type { ModelCallBound } from '@robota-sdk/agent-roundtable';
import { RuntimeParticipantError } from './errors';

type ModelRequestRecord = Extract<TExecutionJournalRecord, { kind: 'model-request' }>;

export interface RequestBoundPolicy {
  providerAttempts: number;
  requestOverheadTokens: number;
}

function unbounded(message: string): never {
  throw new RuntimeParticipantError('unbounded-call', message);
}

function safe(value: number): number {
  if (!Number.isSafeInteger(value)) unbounded('A request bound exceeds a safe integer');
  return value;
}

/**
 * The most one admitted call can consume, taken from the request it is about to send.
 *
 * Input is the UTF-8 size of everything the provider receives — messages, tools, response format
 * and tool choice — plus the host's declared overhead, times the attempts the provider may bill.
 * That bounds the billed input because a token costs at least one byte and the encoding adds
 * structure no token pays for. Output is the request's own cap, times the same attempts. A request
 * whose bound cannot be established is refused rather than sent.
 */
export function requestBound(
  record: ModelRequestRecord,
  policy: RequestBoundPolicy,
): ModelCallBound {
  const cap = record.options.maxTokens;
  if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap <= 0)
    unbounded('A request without a positive output cap has no bound');
  if (record.messages.some((message) => message.parts?.some((part) => part.type !== 'text')))
    unbounded('A request with a non-text part cannot be bounded by its encoded size');
  const hosted = record.options.nativeWebTools;
  if (hosted?.webSearch === true || hosted?.webFetch === true)
    unbounded('A request for provider-hosted web tools is not bounded by the request');
  let encoded: string;
  try {
    encoded = JSON.stringify([
      record.messages,
      record.options.tools ?? [],
      record.options.responseFormat ?? null,
      record.options.toolChoice ?? null,
    ]);
  } catch {
    return unbounded('A request that cannot be encoded has no bound');
  }
  const bytes = new TextEncoder().encode(encoded).length;
  const inputTokens = safe(safe(bytes + policy.requestOverheadTokens) * policy.providerAttempts);
  const maxOutputTokens = safe(cap * policy.providerAttempts);
  safe(inputTokens + maxOutputTokens);
  return { inputTokens, maxOutputTokens };
}
