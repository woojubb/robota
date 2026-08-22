/**
 * INFRA-017: session-log replay provider.
 *
 * A deterministic AI provider that answers each `chat()` call with a response recorded in a session
 * log — so a real conversation can run offline with no network/model key. The replay substrate is the
 * `provider_response_normalized` event the framework already logs per provider call (carrying the
 * normalized `TUniversalMessage`). Responses are replayed in recorded order.
 *
 * This is the provider axis of TEST-008. A log that passes `validateSessionReplayLogEntries`
 * (agent-session) is guaranteed to carry a response for every recorded provider call.
 */
import { AbstractAIProvider } from '@robota-sdk/agent-core';
import {
  resolveSessionLogExternalPayloads,
  SESSION_LOG_EVENT,
  SessionLogPayloadResolutionError,
} from '@robota-sdk/agent-session';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISessionLogEntry } from '@robota-sdk/agent-session';
import type { IExternalPayloadSource } from '@robota-sdk/agent-session';

export interface IReplayProviderOptions {
  /** Recorded session-log lines (e.g. from `loadSessionLogEntries`). */
  readonly entries: readonly ISessionLogEntry[];
  /** Provider name (default `replay`). */
  readonly name?: string;
  /** Provider version (default `1.0.0`). */
  readonly version?: string;
  /** Explicit source used only to resolve external payloads in consumed normalized responses. */
  readonly externalPayloadSource?: IExternalPayloadSource;
  /** Maximum nested external-payload references for direct construction or file loading. */
  readonly maxExternalPayloadDepth?: number;
  /** Aggregate external-payload byte limit for direct construction or file loading. */
  readonly maxExternalPayloadTotalBytes?: number;
}

/** A provider that replays recorded `provider_response_normalized` responses from a session log. */
export class ReplayProvider extends AbstractAIProvider {
  readonly name: string;
  readonly version: string;
  private readonly responses: readonly TUniversalMessage[];
  private cursor = 0;

  constructor(options: IReplayProviderOptions) {
    super();
    this.name = options.name ?? 'replay';
    this.version = options.version ?? '1.0.0';
    this.responses = extractRecordedResponses(options);
  }

  /** Number of recorded provider responses available to replay. */
  get recordedResponseCount(): number {
    return this.responses.length;
  }

  override chat(
    _messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    const next = this.responses[this.cursor];
    if (next === undefined) {
      return Promise.reject(
        new Error(
          `[replay] no recorded provider response for call #${this.cursor + 1} ` +
            `(session log has ${this.responses.length}); the log is exhausted.`,
        ),
      );
    }
    this.cursor += 1;
    return Promise.resolve(next);
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    // Replay yields the recorded normalized response as a single chunk — enough to exercise the
    // streaming → commit path. Byte-exact delta replay can layer on `text_delta` events later.
    yield await this.chat(messages, options);
  }

  override supportsTools(): boolean {
    return true;
  }
}

/** Pull the normalized provider responses out of recorded session-log lines, in order. */
function extractRecordedResponses(options: IReplayProviderOptions): TUniversalMessage[] {
  const recordedValues: unknown[] = [];
  for (const entry of options.entries) {
    if (entry.event !== SESSION_LOG_EVENT.providerResponseNormalized) continue;
    recordedValues.push((entry as { response?: unknown }).response);
  }
  const resolvedValues = resolveRecordedResponsePayloads(recordedValues, options);
  const responses: TUniversalMessage[] = [];
  for (const value of resolvedValues) {
    const normalized = normalizeRecordedMessage(value);
    if (normalized) responses.push(normalized);
  }
  return responses;
}

function resolveRecordedResponsePayloads(
  recordedValues: readonly unknown[],
  options: IReplayProviderOptions,
): readonly unknown[] {
  const referencedIndexes: number[] = [];
  const referencedValues: unknown[] = [];
  recordedValues.forEach((value, index) => {
    if (!containsExternalPayloadReference(value)) return;
    referencedIndexes.push(index);
    referencedValues.push(value);
  });
  if (referencedValues.length === 0) return recordedValues;
  if (options.externalPayloadSource === undefined) {
    throw new SessionLogPayloadResolutionError(
      'UNRESOLVED_REFERENCE',
      'ReplayProvider received an unresolved external payload without an explicit source.',
    );
  }
  const hydrated = resolveSessionLogExternalPayloads(referencedValues, {
    source: options.externalPayloadSource,
    maxDepth: options.maxExternalPayloadDepth,
    maxTotalBytes: options.maxExternalPayloadTotalBytes,
  });
  if (!Array.isArray(hydrated) || hydrated.length !== referencedValues.length) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_JSON',
      'Resolved replay responses did not preserve their array envelope.',
    );
  }
  const resolvedValues = [...recordedValues];
  referencedIndexes.forEach((recordedIndex, hydratedIndex) => {
    resolvedValues[recordedIndex] = hydrated[hydratedIndex];
  });
  return resolvedValues;
}

function containsExternalPayloadReference(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (!Array.isArray(value) && 'kind' in value && value.kind === 'external-payload') return true;
  return Array.isArray(value)
    ? value.some((child) => containsExternalPayloadReference(child, seen))
    : Object.values(value).some((child) => containsExternalPayloadReference(child, seen));
}

/** Coerce a JSON-roundtripped recorded message back into a `TUniversalMessage` (Date timestamp etc.). */
function normalizeRecordedMessage(value: unknown): TUniversalMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const role = record.role;
  if (role !== 'assistant' && role !== 'user' && role !== 'system' && role !== 'tool') {
    return undefined;
  }
  const id = typeof record.id === 'string' ? record.id : `${role}-replay`;
  const timestamp =
    record.timestamp instanceof Date
      ? record.timestamp
      : new Date(typeof record.timestamp === 'string' ? record.timestamp : 0);
  return { ...record, id, role, timestamp } as TUniversalMessage;
}
