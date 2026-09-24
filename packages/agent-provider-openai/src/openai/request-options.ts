import type OpenAI from 'openai';

/**
 * Per-request SDK options, or none at all when there is neither a signal nor a header to send, so
 * a call without either keeps the exact shape it always had.
 */
export function openAIRequestOptions(
  signal: AbortSignal | undefined,
  headers: Readonly<Record<string, string>> | undefined,
): OpenAI.RequestOptions | undefined {
  const hasHeaders = headers !== undefined && Object.keys(headers).length > 0;
  if (!signal && !hasHeaders) return undefined;
  return { ...(signal ? { signal } : {}), ...(hasHeaders ? { headers: { ...headers } } : {}) };
}
