/**
 * Mapping Anthropic's failures onto the shared error taxonomy.
 *
 * One function for the non-streaming path, the streaming path, and a failure the stream reports
 * mid-response: two copies of a taxonomy decision is how the paths end up classifying the same
 * failure differently the first time one of them is edited.
 *
 * An overload can arrive with no HTTP status at all — as an SSE `error` event after the response
 * started, which the SDK throws as an `APIError` whose status is undefined and whose `type` is
 * `overloaded_error`. The type is read off that error the same way as off an HTTP one, so a
 * mid-stream overload is as recognizable as a 529.
 */

import { toProviderError } from '@robota-sdk/agent-core';

/**
 * Re-throw an Anthropic SDK error as a typed provider failure: a `RateLimitError` for a rate limit,
 * a `ProviderError` carrying the HTTP status and Anthropic's error type otherwise. Aborts and
 * errors already in the taxonomy are re-thrown unchanged.
 *
 * Always throws — the return type says so, so a caller cannot fall through it by accident.
 */
export function rethrowAnthropicError(error: unknown): never {
  throw toProviderError(error, 'anthropic', 'Anthropic request failed');
}

/**
 * The stream, with a failure it reports mid-response (an SSE `error` event such as
 * `overloaded_error`) re-thrown as a typed provider failure. Only the stream's own failures pass
 * through the mapping; a consumer that stops early still closes the underlying stream.
 */
export async function* withAnthropicStreamErrors<TEvent>(
  stream: AsyncIterable<TEvent>,
): AsyncGenerator<TEvent> {
  try {
    for await (const event of stream) yield event;
  } catch (error) {
    rethrowAnthropicError(error);
  }
}
