/**
 * Brave Search adapter — the default `IWebSearchProvider` (NEUT-008).
 *
 * This file is the ONLY place the Brave endpoint and env-var wiring live; the tool layer
 * (`web-search-tool.ts`) composes over the vendor-free port. Reads `BRAVE_API_KEY` at call
 * time so the environment can be configured after process start.
 */

import type { IWebSearchProvider, IWebSearchResultItem } from './web-search-provider.js';

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** Brave caps `count` at 20 per request. */
const BRAVE_MAX_COUNT = 20;

interface IBraveResult {
  title: string;
  url: string;
  description: string;
}

interface IBraveResponse {
  web?: {
    results?: IBraveResult[];
  };
}

/**
 * Create the Brave Search provider. Throws from `search()` when `BRAVE_API_KEY` is not set or
 * the API responds with an error — the tool layer surfaces the message as a structured result.
 */
export function createBraveSearchProvider(): IWebSearchProvider {
  return {
    async search({ query, limit }, signal?: AbortSignal): Promise<IWebSearchResultItem[]> {
      const apiKey = process.env['BRAVE_API_KEY'];
      if (!apiKey) {
        throw new Error(
          'Web search requires BRAVE_API_KEY environment variable for the default Brave Search provider, ' +
            'or inject a custom search provider at the composition root.',
        );
      }

      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(limit, BRAVE_MAX_COUNT)),
      });

      const response = await fetch(`${BRAVE_SEARCH_ENDPOINT}?${params}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        throw new Error(`Brave Search API error: HTTP ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as IBraveResponse;
      return (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
    },
  };
}
