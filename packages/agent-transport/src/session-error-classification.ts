/**
 * What the `error` wire frame should say about a session failure, beyond its raw `message` (#3289
 * §3). A renderer maps `code` to one plain sentence with the next step, keeping `message` behind a
 * "Details" disclosure — see `agent-ui-web`'s `SessionNotices`.
 *
 * Walks wrapped layers (`originalError`/`cause`, a few deep) because a higher-level catch can wrap the
 * provider's own typed error in another one (e.g. a "Conversation failed" `ProviderError`) before it
 * reaches here — the same reason `agent-core`'s `classifyProviderFailure` walks layers rather than
 * looking at the outermost error alone.
 */

import {
  AuthenticationError,
  ModelNotAvailableError,
  NetworkError,
  ProviderError,
  RateLimitError,
} from '@robota-sdk/agent-core';

/** Kept in sync with `wire-messages.ts`'s `error` variant — see that type for what each means. */
export type TSessionErrorCode =
  'auth' | 'rate_limit' | 'model_unavailable' | 'network' | 'provider';

export interface ISessionErrorClassification {
  code?: TSessionErrorCode;
  provider?: string;
  retryAfterSeconds?: number;
  /** For `code: 'model_unavailable'`, the model the request tried, when the failure named one. */
  model?: string;
}

const MAX_WRAP_DEPTH = 8;

/** The error and everything it wraps, outermost first, followed to a small depth and never twice. */
function layersOf(error: unknown): unknown[] {
  const layers: unknown[] = [];
  const seen = new Set<unknown>();
  let frontier: unknown[] = [error];
  for (let depth = 0; depth <= MAX_WRAP_DEPTH && frontier.length > 0; depth++) {
    const next: unknown[] = [];
    for (const layer of frontier) {
      if (layer === undefined || layer === null || seen.has(layer)) continue;
      seen.add(layer);
      layers.push(layer);
      if (typeof layer === 'object') {
        const record = layer as Record<string, unknown>;
        next.push(record['originalError'], record['cause']);
      }
    }
    frontier = next;
  }
  return layers;
}

/**
 * Classify a session failure for the wire, or leave it uncoded when it names no provider at all —
 * an unrelated internal failure keeps showing its raw `message` exactly as before this classification
 * existed.
 */
export function classifySessionErrorForWire(error: unknown): ISessionErrorClassification {
  // A generic ProviderError never wins outright — a wrapper (e.g. "Conversation failed") can sit
  // above the real, more specific cause, so it is kept only as a fallback while deeper layers are
  // still searched for one of the specific types below.
  let fallback: ISessionErrorClassification | undefined;
  for (const layer of layersOf(error)) {
    if (layer instanceof AuthenticationError) {
      return { code: 'auth', ...(layer.provider !== undefined && { provider: layer.provider }) };
    }
    if (layer instanceof RateLimitError) {
      return {
        code: 'rate_limit',
        ...(layer.provider !== undefined && { provider: layer.provider }),
        ...(layer.retryAfter !== undefined && { retryAfterSeconds: layer.retryAfter }),
      };
    }
    if (layer instanceof ModelNotAvailableError) {
      return {
        code: 'model_unavailable',
        provider: layer.provider,
        ...(layer.model !== undefined && { model: layer.model }),
      };
    }
    if (layer instanceof NetworkError) {
      return { code: 'network', ...(layer.provider !== undefined && { provider: layer.provider }) };
    }
    if (fallback === undefined && layer instanceof ProviderError) {
      fallback = { code: 'provider', provider: layer.provider };
    }
  }
  return fallback ?? {};
}
