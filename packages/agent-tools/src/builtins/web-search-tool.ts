/**
 * WebSearchTool — search the web and return results.
 *
 * Uses Brave Search API when BRAVE_API_KEY is set.
 * Returns an error with setup instructions otherwise.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
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

async function runWebSearch(args: TWebSearchArgs): Promise<string> {
  const { query, limit = DEFAULT_LIMIT } = args;
  const apiKey = process.env['BRAVE_API_KEY'];

  if (!apiKey) {
    const result: TToolResult = {
      success: false,
      output: '',
      error:
        'Web search requires BRAVE_API_KEY environment variable. ' +
        'Get a free API key at https://brave.com/search/api/ (2,000 queries/month free).',
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
  WebSearchSchema as unknown as IZodSchema,
  async (params) => runWebSearch(params as TWebSearchArgs),
);
