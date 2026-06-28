/**
 * WebFetchTool — fetch a URL and return its content as text.
 *
 * HTML is stripped to plain text for readability. Uses Node.js native fetch.
 * Output is capped at 30K chars (same as other tools).
 */

import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { IToolInvocationResult } from '../types/tool-result.js';

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

export function classifyFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  if (err.name === 'AbortError') {
    return `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s. The server did not respond in time.`;
  }

  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Network error: DNS resolution failed for this host. The URL may be incorrect or the host does not exist. Do not retry with the same URL.`;
  }
  if (code === 'ECONNREFUSED') {
    return `Network error: Connection refused. The server is not accepting connections at this address. Do not retry with the same URL.`;
  }
  if (code === 'ECONNRESET') {
    return `Network error: Connection was reset by the server. The server may be temporarily unavailable.`;
  }
  if (code === 'ETIMEDOUT') {
    return `Network error: Connection timed out. The server is not reachable within the expected time.`;
  }
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return `Network error: SSL certificate error (${code}). The server's certificate is invalid. Do not retry with the same URL.`;
  }

  return `Network error: ${err.message} Check that the URL is correct and the server is reachable.`;
}

async function runWebFetch(args: TWebFetchArgs): Promise<string> {
  const { url, headers } = args;

  try {
    new URL(url);
  } catch {
    // allow-fallback: URL parse failure is a structured tool result, not a thrown error
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Invalid URL: "${url}". Fix the URL format before retrying.`,
    };
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
      const retryHint =
        response.status >= 500
          ? ' The server is temporarily unavailable — retrying may help.'
          : ' Do not retry with the same URL.';
      const result: IToolInvocationResult = {
        success: false,
        output: '',
        error: `HTTP ${response.status} ${response.statusText}.${retryHint}`,
      };
      return JSON.stringify(result);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      const result: IToolInvocationResult = {
        success: false,
        output: '',
        error: `Response too large: ${buffer.byteLength} bytes (max ${MAX_RESPONSE_BYTES}). Consider fetching a more specific URL or a paginated endpoint.`,
      };
      return JSON.stringify(result);
    }

    let text = new TextDecoder().decode(buffer);

    // Strip HTML if content-type indicates HTML
    if (contentType.includes('html')) {
      text = htmlToText(text);
    }

    const result: IToolInvocationResult = { success: true, output: text };
    return JSON.stringify(result);
  } catch (err) {
    // allow-fallback: fetch errors are structured tool results returned to the LLM, not thrown
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: classifyFetchError(err),
    };
    return JSON.stringify(result);
  }
}

export const webFetchTool = createZodFunctionTool(
  'WebFetch',
  'Fetch a URL and return its content as text. HTML pages are converted to plain text.',
  WebFetchSchema,
  async (params) => runWebFetch(params as TWebFetchArgs),
);
