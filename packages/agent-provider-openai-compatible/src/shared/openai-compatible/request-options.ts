import type OpenAI from 'openai';

/**
 * Per-request SDK options, or none at all when there is neither a signal nor a header to send, so
 * a call without either keeps the exact shape it always had. Mirrors
 * `@robota-sdk/agent-provider-openai`'s `openAIRequestOptions` — DeepSeek, Qwen, and Gemma all run
 * on the `openai` SDK and share the same per-request options shape.
 */
export function openAICompatibleRequestOptions(
  signal: AbortSignal | undefined,
  headers: Readonly<Record<string, string>> | undefined,
): OpenAI.RequestOptions | undefined {
  const hasHeaders = headers !== undefined && Object.keys(headers).length > 0;
  if (!signal && !hasHeaders) return undefined;
  return { ...(signal ? { signal } : {}), ...(hasHeaders ? { headers: { ...headers } } : {}) };
}
