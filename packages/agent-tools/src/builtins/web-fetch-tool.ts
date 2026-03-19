/**
 * WebFetchTool — fetch a URL and return its content as text.
 *
 * Uses Node.js native fetch. Converts HTML to plain text by stripping tags.
 * Does NOT execute JavaScript (no headless browser).
 * Output is subject to the 30K char truncation limit in Session.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

const DEFAULT_TIMEOUT_MS = 30_000;

const WebFetchSchema = z.object({
  url: z.string().describe('The URL to fetch (must start with http:// or https://)'),
  headers: z.record(z.string()).optional().describe('Optional HTTP headers as key-value pairs'),
});

type TWebFetchArgs = z.infer<typeof WebFetchSchema>;

/** Strip HTML tags and decode common entities to plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrl(args: TWebFetchArgs): Promise<string> {
  const { url, headers } = args;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: 'URL must start with http:// or https://',
    };
    return JSON.stringify(result);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Robota-CLI/1.0',
        ...headers,
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const result: TToolResult = {
        success: false,
        output: '',
        error: `HTTP ${response.status} ${response.statusText}`,
      };
      return JSON.stringify(result);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    // Convert HTML to plain text
    const isHtml = contentType.includes('text/html');
    const content = isHtml ? htmlToText(body) : body;

    const result: TToolResult = {
      success: true,
      output: content,
    };
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TToolResult = {
      success: false,
      output: '',
      error: message.includes('abort')
        ? `Request timed out after ${DEFAULT_TIMEOUT_MS}ms`
        : message,
    };
    return JSON.stringify(result);
  }
}

export const webFetchTool = createZodFunctionTool(
  'WebFetch',
  'Fetch a URL and return its content as text.\n\n' +
    'Converts HTML pages to plain text automatically. ' +
    'Does NOT execute JavaScript — dynamic/SPA content will not be rendered.\n\n' +
    'Use this to read documentation, API responses, web pages, or any URL content.\n' +
    'Output is limited to 30,000 characters.',
  WebFetchSchema as unknown as IZodSchema,
  async (params) => fetchUrl(params as TWebFetchArgs),
);
