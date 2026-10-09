import { createServer } from 'node:http';

import { expect, it } from 'vitest';
import { createDefaultProviderDefinitions } from './default-provider-definitions.js';
import { createOpenRouterProviderDefinition } from './openrouter-definition.js';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

it('offers one OpenRouter service with browser and key setup over compatible inference', () => {
  const definitions = createDefaultProviderDefinitions();
  const router = definitions.find((definition) => definition.type === 'openrouter');
  expect(router).toBeDefined();
  expect(definitions.filter((definition) => definition.type.startsWith('openrouter'))).toHaveLength(
    1,
  );
  expect(router?.connectionMethods).toEqual(['api-key', 'browser']);
  expect(router?.defaults?.baseURL).toBe('https://openrouter.ai/api/v1');
  expect(router?.setupSteps?.some((step) => step.key === 'baseURL')).toBe(false);
  expect(
    router
      ?.createProvider({
        name: 'openrouter',
        model: 'anthropic/claude-sonnet-4.6',
        apiKey: 'fixture-key',
      })
      .endpointIsVendorDefault?.(),
  ).toBe(false);
});

it('has OpenRouter defaults without native OpenAI catalog, pricing, or model restrictions', () => {
  const definition = createOpenRouterProviderDefinition();
  expect(definition.defaults).toMatchObject({
    model: 'anthropic/claude-sonnet-4.6',
    apiKey: '$ENV:OPENROUTER_API_KEY',
  });
  expect(definition.costPerTokenUsd).toBeUndefined();
  expect(definition.allowedModels).toBeUndefined();
  expect(definition.modelCatalog?.entries).toBeUndefined();
  expect(definition.modelCatalog?.sourceUrl).toContain('openrouter.ai');
  expect(() =>
    definition.createProvider({ name: 'openrouter', model: 'anthropic/claude-sonnet-4.6' }),
  ).toThrow('Provider openrouter requires apiKey');
});

it('uses gateway model IDs and either ordinary key through the same Chat Completions wire', async () => {
  const requests: Array<{
    path: string;
    authorization: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  const model = 'anthropic/claude-sonnet-4.6';
  const server = createServer((request, response) => {
    const answer = async (): Promise<void> => {
      let text = '';
      for await (const chunk of request) text += String(chunk);
      const body: Record<string, unknown> = text
        ? (JSON.parse(text) as Record<string, unknown>)
        : {};
      requests.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });
      if (request.url === '/api/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: model }] }));
        return;
      }
      if (request.url !== '/api/v1/chat/completions') {
        response.writeHead(404);
        response.end();
        return;
      }
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const [content, finishReason] of [
          ['STREAM_OK', null],
          ['', 'stop'],
        ] as const) {
          response.write(
            `data: ${JSON.stringify({
              id: 'synthetic-completion',
              object: 'chat.completion.chunk',
              created: 1,
              model,
              choices: [
                { index: 0, delta: { role: 'assistant', content }, finish_reason: finishReason },
              ],
            })}\n\n`,
          );
        }
        response.end('data: [DONE]\n\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'synthetic-completion',
          object: 'chat.completion',
          created: 1,
          model,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'CHAT_OK' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      );
    };
    void answer().catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address');
  const baseURL = `http://127.0.0.1:${address.port}/api/v1`;
  const definition = createOpenRouterProviderDefinition();
  const message: TUniversalMessage = {
    id: 'synthetic-user',
    role: 'user',
    content: 'Hello',
    state: 'complete',
    timestamp: new Date(),
  };
  try {
    const discovered = await definition.probeProfile?.({ type: 'openrouter', baseURL, model });
    expect(discovered).toMatchObject({ ok: true, models: [model] });
    for (const apiKey of ['synthetic-manual-key', 'synthetic-browser-issued-key']) {
      const provider = definition.createProvider({
        name: 'openrouter',
        baseURL,
        model,
        apiKey,
        options: { apiSurface: 'responses' },
      });
      try {
        expect((await provider.chat([message])).content).toBe('CHAT_OK');
        let streamed = '';
        if (provider.chatStream === undefined) throw new Error('Missing streaming adapter');
        for await (const chunk of provider.chatStream([message])) streamed += chunk.content;
        expect(streamed).toBe('STREAM_OK');
      } finally {
        await provider.dispose?.();
      }
    }
    expect(requests).toHaveLength(5);
    expect(requests[0]).toMatchObject({ path: '/api/v1/models', authorization: undefined });
    expect(requests.slice(1).map((request) => request.path)).toEqual(
      Array(4).fill('/api/v1/chat/completions'),
    );
    expect(requests.slice(1).map((request) => request.body.model)).toEqual(Array(4).fill(model));
    expect(requests.slice(1).map((request) => request.authorization)).toEqual([
      'Bearer synthetic-manual-key',
      'Bearer synthetic-manual-key',
      'Bearer synthetic-browser-issued-key',
      'Bearer synthetic-browser-issued-key',
    ]);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  }
});
