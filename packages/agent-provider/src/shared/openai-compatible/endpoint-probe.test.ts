import { describe, expect, it } from 'vitest';
import { probeOpenAICompatibleProfile, type TOpenAICompatibleFetch } from './endpoint-probe';

describe('probeOpenAICompatibleProfile', () => {
  it('should skip endpoint calls when baseURL is missing', async () => {
    const result = await probeOpenAICompatibleProfile({});

    expect(result).toEqual({
      ok: true,
      message: 'Profile fields are valid; no endpoint probe configured.',
    });
  });

  it('should fetch models from the OpenAI-compatible models endpoint', async () => {
    const requestedUrls: string[] = [];
    const fetcher: TOpenAICompatibleFetch = async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'supergemma4' }, { id: undefined }] }),
      };
    };

    const result = await probeOpenAICompatibleProfile(
      { baseURL: 'http://localhost:1234/v1/' },
      fetcher,
    );

    expect(requestedUrls).toEqual(['http://localhost:1234/v1/models']);
    expect(result).toEqual({
      ok: true,
      message: '1 model(s) discovered',
      models: ['supergemma4'],
    });
  });

  it('should return HTTP failure status', async () => {
    const fetcher: TOpenAICompatibleFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const result = await probeOpenAICompatibleProfile(
      { baseURL: 'http://localhost:1234/v1' },
      fetcher,
    );

    expect(result).toEqual({ ok: false, message: 'HTTP 503' });
  });
});
