/**
 * WebSearchTool — search the web and return results.
 *
 * Vendor-free tool layer (NEUT-008): composes over the duck-typed `IWebSearchProvider` port.
 * The default provider is the vendor-specific default adapter wired at creation time; a custom
 * provider is injected via `createWebSearchTool({ provider })`. Provider failures (missing
 * configuration, HTTP/network errors) are thrown by the provider and surfaced here as
 * structured error results.
 */

import { z } from 'zod';

import { createBraveSearchProvider } from './brave-search-provider.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { IBuiltinToolDescriptionOptions } from './tool-options.js';
import type { IWebSearchProvider, IWebSearchToolProviderOptions } from './web-search-provider.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_WEB_SEARCH_DESCRIPTION =
  'Search the web and return results with title, URL, and snippet.';

const WebSearchSchema = z.object({
  query: z.string().describe('The search query'),
  limit: z
    .number()
    .optional()
    .describe(`Maximum number of results to return (default: ${DEFAULT_LIMIT})`),
});

type TWebSearchArgs = z.infer<typeof WebSearchSchema>;

async function runWebSearch(
  args: TWebSearchArgs,
  provider: IWebSearchProvider,
  signal?: AbortSignal,
): Promise<string> {
  const { query, limit = DEFAULT_LIMIT } = args;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    // CORE-018: run-scoped signal aborts the in-flight request alongside the timeout.
    const searchSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
      const results = await provider.search({ query, limit }, searchSignal);
      const result: IToolInvocationResult = {
        success: true,
        output: JSON.stringify(results, null, 2),
      };
      return JSON.stringify(result);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // allow-fallback: provider failures are structured tool results returned to the LLM, not thrown
    const message = err instanceof Error ? err.message : String(err);
    const result: IToolInvocationResult = { success: false, output: '', error: message };
    return JSON.stringify(result);
  }
}

/** Options for the web-search tool factory: description seam + provider port injection. */
export interface IWebSearchToolOptions
  extends IBuiltinToolDescriptionOptions, IWebSearchToolProviderOptions {}

/**
 * Create a WebSearchTool instance — register with Robota agent tools registry.
 */
export function createWebSearchTool(options: IWebSearchToolOptions = {}): FunctionTool {
  const provider = options.provider ?? createBraveSearchProvider();
  return createZodFunctionTool(
    'WebSearch',
    options.description ?? DEFAULT_WEB_SEARCH_DESCRIPTION,
    WebSearchSchema,
    async (params, context) => runWebSearch(params, provider, context?.signal),
  );
}

/**
 * WebSearchTool instance — register with Robota agent tools registry.
 */
export const webSearchTool = createWebSearchTool();
