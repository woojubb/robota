import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** The subset of the Anthropic SDK's `APIPromise` this module depends on. */
interface IWithResponseCapable<T> {
  withResponse?: () => Promise<{ data: T; request_id?: string | null }>;
}

/**
 * Await an Anthropic `messages.create()` call, reading the server's own request ID off
 * `.withResponse()` when the client exposes it. A test double or older client that resolves to a
 * plain value has no `withResponse`, so this falls back to the awaited value with no ID — never
 * a fabricated one.
 */
export async function awaitWithProviderRequestId<T>(
  call: PromiseLike<T> & IWithResponseCapable<T>,
): Promise<{ data: T; providerRequestId?: string }> {
  if (typeof call.withResponse === 'function') {
    const { data, request_id } = await call.withResponse();
    return {
      data,
      ...(typeof request_id === 'string' && request_id.length > 0 && { providerRequestId: request_id }),
    };
  }
  return { data: await call };
}

/** Merge a provider-returned request ID into a message's metadata; a no-op when there isn't one. */
export function withProviderRequestId<T extends TUniversalMessage>(
  message: T,
  providerRequestId: string | undefined,
): T {
  if (providerRequestId === undefined) return message;
  return { ...message, metadata: { ...message.metadata, providerRequestId } };
}
