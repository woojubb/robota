import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../provider';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

const messages: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() },
];

describe('durable operation identity on the SDK wire', () => {
  for (const apiSurface of ['chat-completions', 'responses'] as const) {
    it(`preserves one identity through ${apiSurface} SDK retries and changes it for a new call`, async () => {
      const identities: Array<string | null> = [];
      let failed = false;
      const client = new OpenAI({
        apiKey: 'task-token', baseURL: 'https://company.example/v1', maxRetries: 1,
        fetch: async (_url, init) => {
          identities.push(new Headers(init?.headers).get('Idempotency-Key'));
          if (!failed) {
            failed = true;
            return new Response('{}', { status: 503, headers: { 'retry-after-ms': '1' } });
          }
          const body = apiSurface === 'responses'
            ? { id: 'r1', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi', annotations: [] }] }] }
            : { id: 'c1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] };
          return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
        },
      });
      const provider = new OpenAIProvider({ client, apiSurface, durableOperations: true });
      await provider.chat(messages, { model: 'test' });
      await provider.chat(messages, { model: 'test' });
      expect(identities).toHaveLength(3);
      expect(identities[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(identities[1]).toBe(identities[0]);
      expect(identities[2]).not.toBe(identities[0]);
    });
  }
});
