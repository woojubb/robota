/**
 * WebFetchTool — fetch a URL and return its content as text.
 *
 * HTML is stripped to plain text for readability. Uses Node.js native fetch.
 * Output is capped at 30K chars (same as other tools).
 */

import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5_000_000; // 5 MB max download

const WebFetchSchema = z.object({
  url: z.string().describe('The URL to fetch'),
  headers: z.record(z.string()).optional().describe('Optional HTTP headers as key-value pairs'),
});

type TWebFetchArgs = z.infer<typeof WebFetchSchema>;

/** Strip HTML tags and decode common entities to produce readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runWebFetch(args: TWebFetchArgs): Promise<string> {
  const { url, headers } = args;

  try {
    new URL(url);
  } catch {
    const result: TToolResult = { success: false, output: '', error: `Invalid URL: ${url}` };
    return JSON.stringify(result);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Robota-CLI/3.0',
        ...(headers ?? {}),
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
    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      const result: TToolResult = {
        success: false,
        output: '',
        error: `Response too large: ${buffer.byteLength} bytes (max ${MAX_RESPONSE_BYTES})`,
      };
      return JSON.stringify(result);
    }

    let text = new TextDecoder().decode(buffer);

    // Strip HTML if content-type indicates HTML
    if (contentType.includes('html')) {
      text = htmlToText(text);
    }

    const result: TToolResult = { success: true, output: text };
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TToolResult = { success: false, output: '', error: message };
    return JSON.stringify(result);
  }
}

export const webFetchTool = createZodFunctionTool(
  'WebFetch',
  'Fetch a URL and return its content as text. HTML pages are converted to plain text.',
  WebFetchSchema as unknown as IZodSchema,
  async (params) => runWebFetch(params as TWebFetchArgs),
);
