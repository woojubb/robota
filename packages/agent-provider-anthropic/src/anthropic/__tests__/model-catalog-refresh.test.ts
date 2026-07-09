import { describe, expect, it, vi } from 'vitest';
import { refreshAnthropicModelCatalog } from '../model-catalog-refresh';

describe('refreshAnthropicModelCatalog', () => {
  it('maps a live Anthropic /v1/models response into provider model catalog entries', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'claude-opus-4-7-20251101', display_name: 'Claude Opus 4.7', type: 'model' },
          { id: 'claude-sonnet-4-6-20251101', display_name: 'Claude Sonnet 4.6', type: 'model' },
        ],
        has_more: false,
      }),
    }));

    const catalog = await refreshAnthropicModelCatalog({ apiKey: 'test-anthropic-key' }, fetcher);

    expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': 'test-anthropic-key',
        'anthropic-version': '2023-06-01',
      },
    });
    expect(catalog.status).toBe('live');
    expect(catalog.entries).toHaveLength(2);
    expect(catalog.entries?.map((e) => e.id)).toEqual([
      'claude-opus-4-7-20251101',
      'claude-sonnet-4-6-20251101',
    ]);
    expect(catalog.entries?.[0]).toMatchObject({
      id: 'claude-opus-4-7-20251101',
      displayName: 'Claude Opus 4.7',
      lifecycle: 'active',
    });
    expect(catalog.entries?.[1]).toMatchObject({
      id: 'claude-sonnet-4-6-20251101',
      displayName: 'Claude Sonnet 4.6',
      lifecycle: 'active',
    });
  });

  it('falls back to id as displayName when display_name is absent', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'claude-haiku-3-5', type: 'model' }],
        has_more: false,
      }),
    }));

    const catalog = await refreshAnthropicModelCatalog({}, fetcher);

    expect(catalog.status).toBe('live');
    expect(catalog.entries?.[0]).toMatchObject({
      id: 'claude-haiku-3-5',
      displayName: 'claude-haiku-3-5',
    });
  });

  it('returns an unavailable catalog when the HTTP response is not ok', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ data: [] }),
    }));

    const catalog = await refreshAnthropicModelCatalog({}, fetcher);

    expect(catalog).toMatchObject({
      status: 'unavailable',
      message: 'Anthropic model refresh failed: HTTP 401',
    });
    expect(catalog.entries).toBeUndefined();
  });

  it('returns an unavailable catalog when a network error is thrown', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    const catalog = await refreshAnthropicModelCatalog({}, fetcher);

    expect(catalog).toMatchObject({
      status: 'unavailable',
      message: 'Anthropic model refresh failed: fetch failed',
    });
    expect(catalog.entries).toBeUndefined();
  });
});
