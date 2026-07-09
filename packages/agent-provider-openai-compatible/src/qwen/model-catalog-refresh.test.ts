import { describe, expect, it, vi } from 'vitest';
import { refreshQwenModelCatalog } from './model-catalog-refresh';

describe('refreshQwenModelCatalog', () => {
  it('maps the live Qwen /models response into provider model catalog entries', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'qwen-plus', object: 'model', owned_by: 'alibaba-cloud' },
          { id: 'qwen-max', object: 'model', owned_by: 'alibaba-cloud' },
          { id: 'qwen-turbo', object: 'model', owned_by: 'alibaba-cloud' },
        ],
      }),
    }));

    const catalog = await refreshQwenModelCatalog(
      {
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
        apiKey: 'test-api-key',
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
      {
        headers: {
          Authorization: 'Bearer test-api-key',
        },
      },
    );
    expect(catalog.status).toBe('live');
    expect(catalog.entries?.map((entry) => entry.id)).toEqual([
      'qwen-plus',
      'qwen-max',
      'qwen-turbo',
    ]);
    expect(catalog.entries?.[0]).toMatchObject({
      id: 'qwen-plus',
      displayName: 'qwen-plus',
      lifecycle: 'active',
    });
  });

  it('uses the default base URL when profile.baseURL is not set', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'qwen-flash' }] }),
    }));

    await refreshQwenModelCatalog({ apiKey: 'test-key' }, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
      expect.anything(),
    );
  });

  it('omits Authorization header when no apiKey is provided', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }));

    await refreshQwenModelCatalog({}, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
      undefined,
    );
  });

  it('returns an unavailable catalog when the live model refresh fails', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ data: [] }),
    }));

    const catalog = await refreshQwenModelCatalog({}, fetcher);

    expect(catalog).toMatchObject({
      status: 'unavailable',
      message: 'Qwen model refresh failed: HTTP 401',
    });
  });
});
