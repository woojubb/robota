/**
 * Opt-in prompt and response content for live telemetry, collected only for the turns prompt
 * history records. Nothing here redacts: the host redacts in its export worker. The framework only
 * pre-truncates, with a margin above the host's bound so the host's exact cut happens after
 * redaction has seen the text around it.
 */
import { isOwnerPromptTurn } from './interactive-session-prompt-history.js';

import type { ILivePromptTracePort } from './interactive-session-live-prompt-trace.js';
import type {
  ILivePromptContentBatch,
  ILivePromptContentItem,
  ILivePromptContentPolicy,
} from '@robota-sdk/agent-interface-analytics';
import type { TDriverId, TTurnSource } from '@robota-sdk/agent-interface-session';

/** Bytes kept beyond the host's per-item bound, so a secret straddling that bound is still whole. */
export const LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES = 1024;
const EMPTY_RESPONSE = '(empty response)';

/** The longest prefix of `text` that fits `maxBytes` of UTF-8 without splitting a character. */
export function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  // Back off continuation bytes (10xxxxxx) so the cut lands on a character boundary.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

function capture(
  kind: ILivePromptContentItem['kind'],
  text: string,
  maxBytes: number,
  partial: boolean,
): ILivePromptContentItem {
  const originalBytes = Buffer.byteLength(text, 'utf8');
  const kept = utf8Prefix(text, maxBytes + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES);
  return {
    kind,
    text: kept,
    originalBytes,
    truncated: kept.length !== text.length,
    ...(partial ? { partial: true as const } : {}),
  };
}

export class LivePromptContentAccumulator {
  private prompt: ILivePromptContentItem | undefined;
  private response: ILivePromptContentItem | undefined;

  constructor(private readonly policy: ILivePromptContentPolicy) {}

  addPrompt(text: string): void {
    if (!this.policy.userPrompts || this.prompt || text.trim().length === 0) return;
    this.prompt = capture('user-prompt', text, this.policy.maxBytes, false);
  }

  /** One response per turn; an interrupted turn's text is `partial`, which is not `truncated`. */
  addResponse(text: string | undefined, interrupted: boolean): void {
    if (!this.policy.assistantResponses || this.response || text === undefined) return;
    if (text === EMPTY_RESPONSE || text.trim().length === 0) return;
    this.response = capture('assistant-response', text, this.policy.maxBytes, interrupted);
  }

  finish(root: ILivePromptContentBatch['root']): ILivePromptContentBatch | undefined {
    const items = [this.prompt, this.response].filter(
      (item): item is ILivePromptContentItem => item !== undefined,
    );
    if (items.length === 0) return undefined;
    return { schemaVersion: 1, root: { ...root }, items };
  }
}

/**
 * Only a host that provided a content port, with a gate on, for an owner-typed turn gets an
 * accumulator. Every other turn copies no text at all.
 */
export function createLivePromptContentAccumulator(
  port: ILivePromptTracePort | undefined,
  turn: { readonly turnSource: TTurnSource; readonly driverId: TDriverId | undefined },
): LivePromptContentAccumulator | undefined {
  const policy = port?.content?.policy;
  if (!policy || (!policy.userPrompts && !policy.assistantResponses)) return undefined;
  if (!isOwnerPromptTurn(turn)) return undefined;
  return new LivePromptContentAccumulator(policy);
}

function reportFailure(port: ILivePromptTracePort, code: 'projection-failed' | 'enqueue-failed'): void {
  try {
    void Promise.resolve(port.onFailure?.(code)).catch(() => undefined);
  } catch {
    // A diagnostic adapter must never alter turn settlement.
  }
}

/** The same isolation as the trace batch: a failing content port never reaches the turn. */
export function enqueueLivePromptContent(
  port: ILivePromptTracePort,
  accumulator: LivePromptContentAccumulator,
  root: ILivePromptContentBatch['root'],
): void {
  let batch: ILivePromptContentBatch | undefined;
  try {
    batch = accumulator.finish(root);
  } catch {
    reportFailure(port, 'projection-failed');
    return;
  }
  const content = port.content;
  if (!batch || !content) return;
  try {
    void Promise.resolve(content.enqueue(batch)).catch(() => reportFailure(port, 'enqueue-failed'));
  } catch {
    reportFailure(port, 'enqueue-failed');
  }
}
