import { describe, expect, it, vi } from 'vitest';
import { refreshDeepSeekModelCatalog } from './model-catalog-refresh';

describe('refreshDeepSeekModelCatalog', () => {
  it('maps the live DeepSeek /models response into provider model catalog entries', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
          { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
          { id: 'custom-deepseek', object: 'model', owned_by: 'deepseek' },
        ],
      }),
    }));

    const catalog = await refreshDeepSeekModelCatalog(
      {
        baseURL: 'https://api.deepseek.com/',
        apiKey: 'deepseek-key',
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith('https://api.deepseek.com/models', {
      headers: {
        Authorization: 'Bearer deepseek-key',
      },
    });
    expect(catalog.status).toBe('live');
    expect(catalog.entries?.map((entry) => entry.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'custom-deepseek',
    ]);
    expect(catalog.entries?.[0]).toMatchObject({
      displayName: 'DeepSeek V4 Flash',
      capabilities: ['tools', 'reasoning', 'json_schema', 'streaming'],
    });
  });

  it('returns an unavailable catalog when the live model refresh fails', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ data: [] }),
    }));

    const catalog = await refreshDeepSeekModelCatalog({}, fetcher);

    expect(catalog).toMatchObject({
      status: 'unavailable',
      message: 'DeepSeek model refresh failed: HTTP 401',
    });
  });
});
