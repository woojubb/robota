/**
 * WebSearchTool — search the internet and return results.
 *
 * Uses Brave Search API when BRAVE_API_KEY is configured.
 * Returns structured results: title, URL, snippet.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

const DEFAULT_RESULT_COUNT = 10;
const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

const WebSearchSchema = z.object({
  query: z.string().describe('Search query string'),
  limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
});

type TWebSearchArgs = z.infer<typeof WebSearchSchema>;

interface IBraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface IBraveResponse {
  web?: {
    results?: IBraveSearchResult[];
  };
}

/** Format search results as readable text */
function formatResults(results: Array<{ title: string; url: string; snippet: string }>): string {
  if (results.length === 0) return '(no results found)';
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
}

async function searchBrave(args: TWebSearchArgs): Promise<string> {
  const apiKey = process.env['BRAVE_API_KEY'];
  if (!apiKey) {
    const result: TToolResult = {
      success: false,
      output: '',
      error:
        'BRAVE_API_KEY is not set. Set the environment variable to enable web search. ' +
        'Get a free API key at https://brave.com/search/api/',
    };
    return JSON.stringify(result);
  }

  const { query, limit } = args;
  const count = limit ?? DEFAULT_RESULT_COUNT;

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
    });

    const response = await fetch(`${BRAVE_API_URL}?${params}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      const result: TToolResult = {
        success: false,
        output: '',
        error: `Brave Search API error: HTTP ${response.status}`,
      };
      return JSON.stringify(result);
    }

    const data = (await response.json()) as IBraveResponse;
    const webResults = data.web?.results ?? [];

    const formatted = webResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));

    const result: TToolResult = {
      success: true,
      output: formatResults(formatted),
    };
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TToolResult = {
      success: false,
      output: '',
      error: `Search failed: ${message}`,
    };
    return JSON.stringify(result);
  }
}

export const webSearchTool = createZodFunctionTool(
  'WebSearch',
  'Search the internet and return results with titles, URLs, and snippets.\n\n' +
    'Requires BRAVE_API_KEY environment variable (free tier: 2,000 searches/month).\n' +
    'Get an API key at https://brave.com/search/api/\n\n' +
    'Use this when you need to find information on the internet. ' +
    'For reading a specific URL, use WebFetch instead.',
  WebSearchSchema as unknown as IZodSchema,
  async (params) => searchBrave(params as TWebSearchArgs),
);
