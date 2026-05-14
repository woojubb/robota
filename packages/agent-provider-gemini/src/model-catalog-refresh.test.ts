import { describe, expect, it, vi } from 'vitest';
import { refreshGeminiModelCatalog } from './model-catalog-refresh';

describe('refreshGeminiModelCatalog', () => {
  it('maps the live Gemini /models response into provider model catalog entries, filtering non-generateContent models', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            description: 'Fast model',
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          },
          {
            name: 'models/gemini-2.0-pro',
            displayName: 'Gemini 2.0 Pro',
            description: 'Pro model',
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/embedding-001',
            displayName: 'Embedding 001',
            description: 'Embedding model only',
            inputTokenLimit: 2048,
            outputTokenLimit: 1,
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }),
    }));

    const catalog = await refreshGeminiModelCatalog({ apiKey: 'gemini-key' }, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=gemini-key',
    );
    expect(catalog.status).toBe('live');
    expect(catalog.entries?.map((entry) => entry.id)).toEqual([
      'gemini-2.0-flash',
      'gemini-2.0-pro',
    ]);
    expect(catalog.entries?.[0]).toMatchObject({
      id: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      lifecycle: 'active',
    });
  });

  it('sets lifecycle to preview when model name contains "preview"', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-3-flash-preview',
            displayName: 'Gemini 3 Flash Preview',
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          },
        ],
      }),
    }));

    const catalog = await refreshGeminiModelCatalog({}, fetcher);

    expect(catalog.status).toBe('live');
    expect(catalog.entries?.[0]).toMatchObject({
      id: 'gemini-3-flash-preview',
      displayName: 'Gemini 3 Flash Preview',
      lifecycle: 'preview',
    });
  });

  it('returns an unavailable catalog when the live model refresh fails', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ models: [] }),
    }));

    const catalog = await refreshGeminiModelCatalog({}, fetcher);

    expect(catalog).toMatchObject({
      status: 'unavailable',
      message: 'Gemini model refresh failed: HTTP 403',
    });
  });

  it('builds URL without key param when no apiKey is provided', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    }));

    await refreshGeminiModelCatalog({}, fetcher);

    expect(fetcher).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models');
  });
});
