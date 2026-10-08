import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createGemmaProviderDefinition } from './provider-definition';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

interface IFixtureRequest {
  path: string | undefined;
  authorization: string | undefined;
}

const messages: TUniversalMessage[] = [
  { id: 'user-1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() },
];

async function withLocalServer(
  requiredToken: string | undefined,
  run: (baseURL: string, requests: IFixtureRequest[]) => Promise<void>,
): Promise<void> {
  const requests: IFixtureRequest[] = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (
      requiredToken !== undefined &&
      request.headers.authorization !== `Bearer ${requiredToken}`
    ) {
      response.writeHead(401);
      response.end(
        JSON.stringify({ error: { message: 'Server token required', type: 'invalid_api_key' } }),
      );
      return;
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      response.end(
        JSON.stringify({
          id: 'fixture-completion',
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'fixture response' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected a local fixture port');
  try {
    await run(`http://127.0.0.1:${address.port}/v1`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('local provider credentials on the wire', () => {
  it('probes and completes a real SDK request with no configured server credential', async () => {
    await withLocalServer(undefined, async (baseURL, requests) => {
      const definition = createGemmaProviderDefinition();
      const profile = { type: 'gemma', model: 'fixture-model', baseURL };
      expect(await definition.probeProfile?.(profile)).toEqual({
        ok: true,
        message: '1 model(s) discovered',
        models: ['fixture-model'],
      });
      const provider = definition.createProvider({
        name: 'gemma',
        model: 'fixture-model',
        baseURL,
      });
      expect((await provider.chat(messages, { model: 'fixture-model' })).content).toBe(
        'fixture response',
      );
      expect(requests).toEqual([
        { path: '/v1/models', authorization: undefined },
        { path: '/v1/chat/completions', authorization: 'Bearer lm-studio' },
      ]);
    });
  });

  it('uses an explicit server token for both discovery and inference', async () => {
    const apiKey = 'synthetic-server-token';
    await withLocalServer(apiKey, async (baseURL, requests) => {
      const definition = createGemmaProviderDefinition();
      expect(
        await definition.probeProfile?.({ type: 'gemma', model: 'fixture-model', apiKey, baseURL }),
      ).toEqual({
        ok: true,
        message: '1 model(s) discovered',
        models: ['fixture-model'],
      });
      const provider = definition.createProvider({
        name: 'gemma',
        model: 'fixture-model',
        apiKey,
        baseURL,
      });
      expect((await provider.chat(messages, { model: 'fixture-model' })).content).toBe(
        'fixture response',
      );
      expect(requests).toEqual([
        { path: '/v1/models', authorization: `Bearer ${apiKey}` },
        { path: '/v1/chat/completions', authorization: `Bearer ${apiKey}` },
      ]);
    });
  });

  it('reports that the configured endpoint rejected authentication', async () => {
    await withLocalServer('synthetic-server-token', async (baseURL) => {
      const result = await createGemmaProviderDefinition().probeProfile?.({
        type: 'gemma',
        baseURL,
      });
      expect(result).toMatchObject({ ok: false });
      expect(result?.message).toContain('HTTP 401');
      expect(result?.message).toContain('rejected authentication');
    });
  });
});
