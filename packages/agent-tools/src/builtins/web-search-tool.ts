/**
 * WebSearchTool — search the web and return results.
 *
 * Uses You.com Search API when YDC_API_KEY is set (or free-tier when omitted).
 * Falls back to Brave Search API when BRAVE_API_KEY is set.
 * Returns an error with setup instructions otherwise.
 */

import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { TToolResult } from '../types/tool-result.js';

const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

const WebSearchSchema = z.object({
  query: z.string().describe('The search query'),
  limit: z
    .number()
    .optional()
    .describe(`Maximum number of results to return (default: ${DEFAULT_LIMIT})`),
});

type TWebSearchArgs = z.infer<typeof WebSearchSchema>;

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

interface IYouSearchResult {
  url: string;
  title: string;
  description?: string;
  snippets?: string[];
}

interface IYouSearchResponse {
  results?: {
    web?: IYouSearchResult[];
    news?: IYouSearchResult[];
  };
}

async function runWebSearch(args: TWebSearchArgs): Promise<string> {
  const { query, limit = DEFAULT_LIMIT } = args;
  const youApiKey = process.env['YDC_API_KEY'];
  const apiKey = process.env['BRAVE_API_KEY'];

  if (youApiKey || !apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const params = new URLSearchParams({ query, count: String(Math.min(limit, 100)) });
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (youApiKey) headers['X-API-Key'] = youApiKey;

      const response = await fetch(`https://api.you.com/v1/agents/search?${params}`, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text();
        const result: TToolResult = {
          success: false,
          output: '',
          error: `You.com Search API error: HTTP ${response.status} ${response.statusText}. ${body}`,
        };
        return JSON.stringify(result);
      }

      const data = (await response.json()) as IYouSearchResponse;
      const combined = [...(data.results?.web ?? []), ...(data.results?.news ?? [])].slice(
        0,
        limit,
      );
      const results = combined.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? r.snippets?.[0] ?? '',
      }));

      const result: TToolResult = { success: true, output: JSON.stringify(results, null, 2) };
      return JSON.stringify(result);
    } catch (err) {
      if (!apiKey) {
        const message = err instanceof Error ? err.message : String(err);
        const result: TToolResult = { success: false, output: '', error: message };
        return JSON.stringify(result);
      }
    }
  }

  if (!apiKey) {
    const result: TToolResult = {
      success: false,
      output: '',
      error:
        'Web search requires YDC_API_KEY (recommended; Search API supports free daily usage) or BRAVE_API_KEY. ' +
        'Get YDC key at https://you.com/platform or Brave key at https://brave.com/search/api/.',
    };
    return JSON.stringify(result);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(limit, 20)),
    });

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const result: TToolResult = {
        success: false,
        output: '',
        error: `Brave Search API error: HTTP ${response.status} ${response.statusText}`,
      };
      return JSON.stringify(result);
    }

    const data = (await response.json()) as IBraveResponse;
    const results = (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));

    const result: TToolResult = { success: true, output: JSON.stringify(results, null, 2) };
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TToolResult = { success: false, output: '', error: message };
    return JSON.stringify(result);
  }
}

export const webSearchTool = createZodFunctionTool(
  'WebSearch',
  'Search the web and return results with title, URL, and snippet.',
  WebSearchSchema,
  async (params) => runWebSearch(params as TWebSearchArgs),
);
