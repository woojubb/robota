/**
 * WebFetchTool — fetch a URL and return its content as text.
 *
 * HTML is stripped to plain text for readability. Fetches through the shared egress boundary
 * (`fetchWithEgressPolicy`, #2026): loopback / private / link-local / metadata destinations are
 * refused, redirects are re-validated, and the response is capped while streaming.
 *
 * After an HTML page, the tool checks once per origin whether the site publishes an llms.txt index
 * (https://llmstxt.org/) and, if so, appends a pointer to it. The index itself is never inlined: the
 * model decides whether the curated map is worth a fetch.
 */

import { fetchWithEgressPolicy } from '@robota-sdk/agent-core/node';
import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { IBuiltinToolDescriptionOptions } from './tool-options.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';
import type { IEgressDeps, IEgressPolicy } from '@robota-sdk/agent-core/node';

// CORE-030: defining a tool and telling the permission system what it does arrive together.
import '../tool-permission-profiles.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5_000_000; // 5 MB max download
/** The probe must never noticeably delay the page it accompanies, nor download a large index. */
const LLMS_TXT_PROBE_TIMEOUT_MS = 2_000;
const LLMS_TXT_PROBE_MAX_BYTES = 512_000;

const WebFetchSchema = z.object({
  url: z.string().describe('The URL to fetch'),
  headers: z.record(z.string()).optional().describe('Optional HTTP headers as key-value pairs'),
});

type TWebFetchArgs = z.infer<typeof WebFetchSchema>;

/** #2026: the egress policy this tool fetches under, and the deps a test injects (fetch, DNS lookup). */
export interface IWebFetchEgressOptions {
  policy?: IEgressPolicy;
  deps?: IEgressDeps;
}

export interface IWebFetchToolOptions extends IBuiltinToolDescriptionOptions {
  egress?: IWebFetchEgressOptions;
  /** Host-selected HTTP identity; omitted for SDK consumers that do not identify a product. */
  userAgent?: string;
  /** Check an HTML page's origin for an llms.txt index and point to it. Default `true`. */
  llmsTxtProbe?: boolean;
}

/** Per-tool-instance cache of llms.txt probes, keyed by origin. A miss is cached like a hit. */
type TLlmsTxtCache = Map<string, Promise<string | undefined>>;

/**
 * Remove every `<tag>…</tag>` element — the linear equivalent of `replace(/<tag[\s\S]*?<\/tag>/gi, '')`.
 *
 * The regex form is quadratic: every `<tag` with no closing tag after it rescans to end of input, and the scan
 * then restarts at the next one. `htmlToText`'s input is a **response body from an arbitrary URL**, capped only
 * at {@link MAX_RESPONSE_BYTES} (5 MB) — 5 MB of `<script` would have taken minutes. Because the closing tag is
 * searched forward, its absence at one opener means no later opener can have one either, so the scan stops.
 *
 * Case folding is `[A-Z]`-only, not `toLowerCase()`: `toLowerCase()` can change a string's LENGTH (U+0130
 * lowercases to two code units), which would desynchronise the indices from the original text.
 */
function stripElement(html: string, tag: string): string {
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  const haystack = html.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = haystack.indexOf(openTag, cursor);
    if (open < 0) break;
    const close = haystack.indexOf(closeTag, open + openTag.length);
    if (close < 0) break;
    parts.push(html.slice(cursor, open));
    cursor = close + closeTag.length;
  }
  parts.push(html.slice(cursor));
  return parts.join('');
}

/**
 * Replace every `<…>` tag with a space — the linear equivalent of `replace(/<[^>]+>/g, ' ')`.
 *
 * Same defect, same input: `[^>]+` cannot cross a `>`, so a `<` with no `>` after it consumed the rest of the
 * document and then backtracked over it, once per `<`. A page of 200 K `<` characters took 12.6 s; the 5 MB the
 * fetch allows would have taken hours. `close === open + 1` reproduces the regex's `+` (a tag body must be at
 * least one character), so a literal `<>` is left in the text exactly as before.
 */
function stripTags(html: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = html.indexOf('<', cursor);
    if (open < 0) break;
    const close = html.indexOf('>', open + 1);
    if (close < 0) break;
    if (close === open + 1) {
      parts.push(html.slice(cursor, open + 1));
      cursor = open + 1;
      continue;
    }
    parts.push(html.slice(cursor, open), ' ');
    cursor = close + 1;
  }
  parts.push(html.slice(cursor));
  return parts.join('');
}

/**
 * The character entities {@link htmlToText} decodes, and the single alternation that matches them.
 *
 * SEC-004 (`js/double-escaping`): decoding these by CHAINED `.replace()` calls with `&amp;` first
 * decodes twice. `&amp;lt;` — how a page encodes the literal text `&lt;` so a browser DISPLAYS it —
 * became `&lt;` after the `&amp;` pass and then `<` after the `&lt;` pass, so a page reading
 * `&amp;lt;script&amp;gt;` came back out of a tag-stripping converter as `<script>`. One pass over
 * one alternation decodes each entity exactly once and never rescans its own output, so the decoder
 * is the inverse of the encoder for every input rather than only for singly-encoded ones.
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};
const HTML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|nbsp|#39);/g;

/** Strip HTML tags and decode common entities to produce readable text. */
function htmlToText(html: string): string {
  return stripTags(stripElement(stripElement(html, 'script'), 'style'))
    .replace(HTML_ENTITY_PATTERN, (entity) => HTML_ENTITIES[entity])
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

/**
 * An llms.txt index counts only as a 2xx plain-text or Markdown body whose first non-blank line is an
 * H1, as the format requires. That rejects the common soft 404: the site's HTML shell served with 200.
 */
function isLlmsTxtIndex(contentType: string, body: Uint8Array): boolean {
  if (!/text\/(plain|markdown)/i.test(contentType)) return false;
  const firstLine = new TextDecoder()
    .decode(body)
    .split(/\r?\n/)
    .find((line) => line.trim() !== '');
  return firstLine?.startsWith('# ') ?? false;
}

/**
 * Resolve to the origin's llms.txt URL when it publishes a valid index, else `undefined`. Never
 * rejects: a probe that is refused, times out or fails is simply a miss. Only the host-selected
 * User-Agent is sent; headers the caller supplied for the page are not forwarded to the probe.
 */
async function probeLlmsTxt(
  origin: string,
  egress: IWebFetchEgressOptions,
  userAgent: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const indexUrl = `${origin}/llms.txt`;
  try {
    const response = await fetchWithEgressPolicy(
      indexUrl,
      {
        headers: userAgent === undefined ? {} : { 'User-Agent': userAgent },
        signal,
        timeoutMs: LLMS_TXT_PROBE_TIMEOUT_MS,
        maxResponseBytes: LLMS_TXT_PROBE_MAX_BYTES,
      },
      egress.policy,
      egress.deps,
    );
    if (!response.ok || response.status < 200 || response.status >= 300) return undefined;
    return isLlmsTxtIndex(response.headers.get('content-type') ?? '', response.body) ? indexUrl : undefined;
  } catch {
    // allow-fallback: the probe is advisory; its failure must leave the main fetch result unchanged
    return undefined;
  }
}

function llmsTxtPointer(indexUrl: string): string {
  return `\n\nThis site publishes an LLM index at ${indexUrl} (llms.txt); fetch it for a curated map of the docs.`;
}

async function runWebFetch(
  args: TWebFetchArgs,
  egress: IWebFetchEgressOptions,
  userAgent: string | undefined,
  llmsTxtCache: TLlmsTxtCache | undefined,
  signal?: AbortSignal,
): Promise<string> {
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
    // #2026: destination safety, redirect re-validation, the deadline (composed with the CORE-018
    // run-scoped signal) and the streaming byte cap all live in the shared egress boundary.
    const response = await fetchWithEgressPolicy(
      url,
      {
        headers: { ...(userAgent === undefined ? {} : { 'User-Agent': userAgent }), ...(headers ?? {}) },
        signal,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      },
      egress.policy,
      egress.deps,
    );

    if (!response.ok) {
      const { rejection } = response;
      const error =
        rejection.reason === 'response_too_large'
          ? `Response too large (max ${MAX_RESPONSE_BYTES} bytes). Consider fetching a more specific URL or a paginated endpoint.`
          : `Blocked by egress policy: ${rejection.message} Do not retry with the same URL.`;
      const result: IToolInvocationResult = { success: false, output: '', error };
      return JSON.stringify(result);
    }

    if (response.status < 200 || response.status >= 300) {
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
    let text = new TextDecoder().decode(response.body);

    // Strip HTML if content-type indicates HTML
    if (contentType.includes('html')) {
      // The probe runs while the page is converted, so it adds little to the fetch's latency.
      const origin = new URL(response.finalUrl).origin;
      let probe = llmsTxtCache?.get(origin);
      if (llmsTxtCache && probe === undefined) {
        const started: Promise<string | undefined> = probeLlmsTxt(origin, egress, userAgent, signal).then((indexUrl) => {
          // A cancelled run says nothing about the site, so it must not be remembered as a miss.
          if (indexUrl === undefined && signal?.aborted && llmsTxtCache.get(origin) === started) {
            llmsTxtCache.delete(origin);
          }
          return indexUrl;
        });
        probe = started;
        llmsTxtCache.set(origin, probe);
      }
      text = htmlToText(text);
      const indexUrl = await probe;
      if (indexUrl !== undefined) text += llmsTxtPointer(indexUrl);
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

const WEB_FETCH_DESCRIPTION_BASE =
  'Fetch a URL and return its content as text. HTML pages are converted to plain text. ' +
  'Documentation sites may publish a curated index at /llms.txt (full text at /llms-full.txt)';
const DEFAULT_WEB_FETCH_DESCRIPTION = `${WEB_FETCH_DESCRIPTION_BASE}; when a fetched page's site has one, the result points to it.`;
/** Without the probe the runtime adds no pointer, so the description must not promise one. */
const UNPROBED_WEB_FETCH_DESCRIPTION = `${WEB_FETCH_DESCRIPTION_BASE}.`;

/**
 * Create a WebFetchTool instance — register with agent tools registry.
 */
export function createWebFetchTool(options: IWebFetchToolOptions = {}): FunctionTool {
  const egress = options.egress ?? {};
  const llmsTxtCache: TLlmsTxtCache | undefined = options.llmsTxtProbe === false ? undefined : new Map();
  return createZodFunctionTool(
    'WebFetch',
    options.description ?? (llmsTxtCache ? DEFAULT_WEB_FETCH_DESCRIPTION : UNPROBED_WEB_FETCH_DESCRIPTION),
    WebFetchSchema,
    async (params, context) => runWebFetch(params, egress, options.userAgent, llmsTxtCache, context?.signal),
  );
}

/**
 * WebFetchTool instance — register with agent tools registry.
 */
export const webFetchTool = createWebFetchTool();
