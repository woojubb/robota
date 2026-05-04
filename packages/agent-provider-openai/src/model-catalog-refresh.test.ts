import { describe, expect, it } from 'vitest';
import type {
  IOpenAIModelCatalogFetchInit,
  IOpenAIModelCatalogFetchResponse,
} from './model-catalog-refresh';
import { refreshOpenAIModelCatalog } from './model-catalog-refresh';

function createModelCatalogResponse(
  body: IOpenAIModelCatalogFetchResponse['json'],
): IOpenAIModelCatalogFetchResponse {
  return {
    ok: true,
    status: 200,
    json: body,
  };
}

describe('refreshOpenAIModelCatalog', () => {
  it('queries the OpenAI models endpoint and returns live catalog entries', async () => {
    const requests: Array<{ url: string; init: IOpenAIModelCatalogFetchInit }> = [];
    const catalog = await refreshOpenAIModelCatalog(
      { type: 'openai', model: 'gpt-5.1', apiKey: 'sk-test' },
      {
        now: () => new Date('2026-05-05T00:00:00.000Z'),
        fetcher: async (url, init) => {
          requests.push({ url, init });
          return createModelCatalogResponse(async () => ({
            data: [{ id: 'gpt-5.1' }, { id: 'gpt-5.1-mini' }, { id: '' }],
          }));
        },
      },
    );

    expect(requests).toEqual([
      {
        url: 'https://api.openai.com/v1/models',
        init: { headers: { Authorization: 'Bearer sk-test' } },
      },
    ]);
    expect(catalog).toMatchObject({
      status: 'live',
      lastVerifiedAt: '2026-05-05T00:00:00.000Z',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
    });
    expect(catalog.entries?.map((entry) => entry.id)).toEqual(['gpt-5.1', 'gpt-5.1-mini']);
  });

  it('uses profile baseURL for OpenAI-compatible model discovery', async () => {
    const requestedUrls: string[] = [];

    await refreshOpenAIModelCatalog(
      {
        type: 'openai',
        model: 'local-model',
        apiKey: 'local-key',
        baseURL: 'http://localhost:1234/v1/',
      },
      {
        fetcher: async (url) => {
          requestedUrls.push(url);
          return createModelCatalogResponse(async () => ({ data: [] }));
        },
      },
    );

    expect(requestedUrls).toEqual(['http://localhost:1234/v1/models']);
  });

  it('returns unavailable catalog state when credentials are missing', async () => {
    const catalog = await refreshOpenAIModelCatalog({ type: 'openai', model: 'gpt-5.1' });

    expect(catalog.status).toBe('unavailable');
    expect(catalog.message).toBe('OpenAI model catalog refresh requires apiKey.');
  });

  it('returns unavailable catalog state when the endpoint rejects discovery', async () => {
    const catalog = await refreshOpenAIModelCatalog(
      { type: 'openai', model: 'gpt-5.1', apiKey: 'sk-test' },
      {
        fetcher: async () => ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ data: [] }),
        }),
      },
    );

    expect(catalog.status).toBe('unavailable');
    expect(catalog.message).toBe('OpenAI model catalog refresh failed: HTTP 401 Unauthorized');
  });
});
