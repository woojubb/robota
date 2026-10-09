import { OrganizationNoEffect, OrganizationRefused } from '@robota-sdk/agent-organization-host';
import type { IOrganizationAction, IOrganizationUnits } from '@robota-sdk/agent-organization-host';
import type { HostedOrganizationPayloads } from './hosted-organization-payloads.js';

export interface IHostedOrganizationModelOptions {
  readonly payloads: HostedOrganizationPayloads;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly roles: readonly string[];
  readonly resource: string;
  readonly reservation: IOrganizationUnits;
  readonly maxInputBytes: number;
  readonly maxOutputTokens: number;
  readonly costMicrosPerToken: number;
  /** Declare only an upstream contract actually supported by the owner-selected provider. */
  readonly providerIdempotency: boolean;
  /** Owner-selected pure input counter for the exact immutable provider request, including tools/media. */
  countInputTokens(surface: 'responses' | 'chat-completions', request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<number>;
}

/** Actual fixed-provider HTTP effect. No automatic retry; ambiguous outcomes retain the broker hold. */
export function createHostedOrganizationModelAction(options: IHostedOrganizationModelOptions): IOrganizationAction {
  const endpoint = new URL(options.endpoint);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname))) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    typeof options.apiKey !== 'string' || /[\r\n]/u.test(options.apiKey) || options.apiKey.length === 0 ||
    !Number.isSafeInteger(options.maxInputBytes) || options.maxInputBytes < 1 || options.maxInputBytes > 4 * 1024 * 1024 ||
    !Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 ||
    !Number.isSafeInteger(options.costMicrosPerToken) || options.costMicrosPerToken < 0 ||
    typeof options.countInputTokens !== 'function')
    throw new OrganizationRefused('invalid-schema');
  const reservation = Object.freeze({ ...options.reservation });
  const countInputTokens = options.countInputTokens.bind(options);
  const parameters = (value: unknown): { request: string; surface: 'responses' | 'chat-completions' } => {
    const data = value as { request?: unknown; surface?: unknown };
    if (!data || Object.keys(data).sort().join(',') !== 'request,surface' ||
      typeof data.request !== 'string' || !/^[a-f0-9]{64}$/u.test(data.request) ||
      !['responses', 'chat-completions'].includes(String(data.surface)))
      throw new OrganizationRefused('invalid-schema');
    return data as { request: string; surface: 'responses' | 'chat-completions' };
  };
  return {
    resource: options.resource, operation: 'generate', roles: [...options.roles], requiresApproval: false,
    reserve: (operation) => { parameters(operation.parameters); return reservation; },
    execute: async (operation, context) => {
      const input = parameters(operation.parameters);
      const wire = await options.payloads.get(context.identity.id, input.request);
      if (wire.length > options.maxInputBytes) throw new OrganizationRefused('invalid-schema');
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire)) as Record<string, unknown>;
      if (!body || Array.isArray(body) || body.model !== options.model) throw new OrganizationRefused('not-authorized');
      const upstreamBody: Record<string, unknown> = { ...body, stream: false };
      if (['conversation', 'previous_response_id', 'prompt'].some((key) => upstreamBody[key] != null) ||
        (Array.isArray(upstreamBody.tools) && upstreamBody.tools.some((tool) => (tool as { type?: unknown })?.type !== 'function')))
        throw new OrganizationNoEffect('not-authorized', { tokens: 0, timeMs: 0, costMicros: 0 });
      delete upstreamBody.max_tokens;
      delete upstreamBody.max_completion_tokens;
      delete upstreamBody.max_output_tokens;
      delete upstreamBody.stream_options;
      upstreamBody[input.surface === 'responses' ? 'max_output_tokens' : 'max_completion_tokens'] = options.maxOutputTokens;
      upstreamBody.store = false;
      upstreamBody.n = input.surface === 'chat-completions' ? 1 : undefined;
      if (input.surface === 'responses') { delete upstreamBody.n; upstreamBody.background = false; }
      const encoded = JSON.stringify(upstreamBody);
      const inputTokens = await countInputTokens(input.surface, JSON.parse(encoded) as Record<string, unknown>, context.signal);
      const maximum = inputTokens + options.maxOutputTokens;
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(maximum) ||
        maximum > reservation.tokens || !Number.isSafeInteger(maximum * options.costMicrosPerToken) || maximum * options.costMicrosPerToken > reservation.costMicros)
        throw new OrganizationNoEffect('budget-exhausted', { tokens: 0, timeMs: 0, costMicros: 0 });
      context.signal.throwIfAborted();
      const response = await fetch(`${endpoint.href.replace(/\/$/u, '')}/${input.surface === 'responses' ? 'responses' : 'chat/completions'}`, {
        method: 'POST', redirect: 'error', signal: context.signal,
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json',
          ...(options.providerIdempotency ? { 'Idempotency-Key': context.operationDigest } : {}) },
        body: encoded,
      });
      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        throw new OrganizationRefused('outcome-unknown');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.length;
          if (size > 4 * 1024 * 1024) throw new OrganizationRefused('outcome-unknown');
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      const bytes = Buffer.concat(chunks);
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { usage?: { total_tokens?: unknown } };
      const tokens = result?.usage?.total_tokens;
      if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > reservation.tokens ||
        !Number.isSafeInteger(tokens * options.costMicrosPerToken) || tokens * options.costMicrosPerToken > reservation.costMicros)
        throw new OrganizationRefused('outcome-unknown');
      const digest = await options.payloads.put(context.identity.id, bytes);
      return { value: { response: digest }, usage: { tokens, timeMs: 0, costMicros: tokens * options.costMicrosPerToken } };
    },
  };
}
