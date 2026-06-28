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
import { SESSION_LOG_EVENT } from '@robota-sdk/agent-session';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISessionLogLine } from '@robota-sdk/agent-session';

export interface IReplayProviderOptions {
  /** Recorded session-log lines (e.g. from `loadSessionLogEntries`). */
  readonly entries: readonly ISessionLogLine[];
  /** Provider name (default `replay`). */
  readonly name?: string;
  /** Provider version (default `1.0.0`). */
  readonly version?: string;
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
    this.responses = extractRecordedResponses(options.entries);
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
function extractRecordedResponses(entries: readonly ISessionLogLine[]): TUniversalMessage[] {
  const responses: TUniversalMessage[] = [];
  for (const entry of entries) {
    if (entry.event !== SESSION_LOG_EVENT.providerResponseNormalized) continue;
    const normalized = normalizeRecordedMessage((entry as { response?: unknown }).response);
    if (normalized) responses.push(normalized);
  }
  return responses;
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
