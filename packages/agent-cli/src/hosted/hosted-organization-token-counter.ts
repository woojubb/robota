import { OrganizationRefused } from '@robota-sdk/agent-organization-host';
import type { IHostedOrganizationModelOptions } from './hosted-organization-model.js';

/** Fixed owner counter transport. The owner encoder must preserve the provider's full input-token contract. */
export function createHostedOrganizationInputTokenCounter(options: {
  readonly endpoint: string;
  readonly apiKey: string;
  /** Explicit provider mapping: Responses counting accepts input/model/tools, while Chat needs its own verified counter. */
  encode(surface: 'responses' | 'chat-completions', request: Readonly<Record<string, unknown>>): unknown;
}): IHostedOrganizationModelOptions['countInputTokens'] {
  const endpoint = new URL(options.endpoint);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname))) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash || typeof options.encode !== 'function' ||
    typeof options.apiKey !== 'string' || options.apiKey.length === 0 || /[\r\n]/u.test(options.apiKey))
    throw new OrganizationRefused('invalid-schema');
  const apiKey = options.apiKey; const encode = options.encode.bind(options);
  return async (surface, body, signal) => {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(encode(surface, body)) });
    if (!response.ok || response.body === null) { await response.body?.cancel(); throw new OrganizationRefused('policy-unavailable'); }
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length;
        if (size > 64 * 1024) throw new OrganizationRefused('policy-unavailable'); chunks.push(next.value); }
    } finally { await reader.cancel(); }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as { input_tokens?: unknown };
    if (!Number.isSafeInteger(result?.input_tokens) || (result.input_tokens as number) < 0)
      throw new OrganizationRefused('policy-unavailable');
    return result.input_tokens as number;
  };
}
