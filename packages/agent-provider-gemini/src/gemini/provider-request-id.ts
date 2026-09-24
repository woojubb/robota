import type { GenerateContentResponse } from '@google/genai';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * Read the server's own response ID off a Gemini `GenerateContentResponse`, never a fabricated
 * one. `responseId` is the encoding of the event ID Gemini assigns to each response, including
 * each chunk of a streamed one.
 */
export function readGeminiResponseId(response: GenerateContentResponse | undefined): string | undefined {
  const id = response?.responseId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** Merge a provider-returned request ID into a message's metadata; a no-op when there isn't one. */
export function withProviderRequestId<T extends TUniversalMessage>(
  message: T,
  providerRequestId: string | undefined,
): T {
  if (providerRequestId === undefined) return message;
  return { ...message, metadata: { ...message.metadata, providerRequestId } };
}
