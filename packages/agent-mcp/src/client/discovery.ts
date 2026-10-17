/**
 * Caller-owned pagination driver for MCP discovery (MCP-002, TC-02, TC-04, TC-19).
 *
 * For each domain the server never declared, the corresponding list request is NEVER sent — the
 * domain surfaces as `{ state: { kind: 'unsupported' }, items: [], pages: 0 }` (TC-04).
 * For a declared domain, pages are drained by following `nextCursor` until it is ABSENT
 * (`undefined`); a present-but-empty cursor is treated as invalid, never as "no more pages". A
 * catalog is never returned partial: any failure throws `MCPDiscoveryError` instead of resolving
 * with what was gathered so far.
 */

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client';

import { parseMCPResultSizeMetadata } from '../catalog/result-size-metadata.js';
import { MCPDiscoveryError } from '../catalog/types.js';
import { toUniversalObject } from '../catalog/universal-value.js';
import { isRequestTimeout } from './session-protocol.js';
import { statelessCacheHint } from './stateless-result.js';

import type { IMCPDiscoverOptions } from './session-types.js';
import type {
  IMCPDiscoveredPrompt,
  IMCPDiscoveredResource,
  IMCPDiscoveredTool,
  IMCPDiscovery,
  IMCPDiscoveryDomainResult,
  IMCPResponseCacheHint,
  IMCPServerIdentity,
  TMCPCapabilityDomain,
} from '../catalog/types.js';
import type { ResultTypeMap, Tool } from '@modelcontextprotocol/client';
import type { IParameterSchema } from '@robota-sdk/agent-core';

type TDeclaredCapabilities = Readonly<
  Record<TMCPCapabilityDomain, { readonly listChanged: boolean } | undefined>
>;

type TRawTool = Omit<Tool, 'inputSchema' | 'outputSchema'> & {
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
};
type TRawPrompt = ResultTypeMap['prompts/list']['prompts'][number];
type TRawResource = ResultTypeMap['resources/list']['resources'][number];

type TListMethod = 'tools/list' | 'prompts/list' | 'resources/list';

/**
 * The one request seam discovery needs. Pages are fetched one `request` at a time — never through
 * the SDK's aggregating `listTools()` — so the page bound, cursor validation and the no-partial
 * catalog rule stay this module's. The two-argument form validates each page with the negotiated
 * era's own result schema — the one the SDK applies to a single `listTools({ cursor })` page — so
 * no era-blind schema stands between a server and the catalog.
 */
export interface IMCPDiscoveryClient {
  request<TMethod extends TListMethod>(
    request: { readonly method: TMethod; readonly params: { readonly cursor?: string } },
    options: { readonly timeout: number; readonly signal?: AbortSignal },
  ): Promise<ResultTypeMap[TMethod]>;
}

interface IListPage<TRaw> {
  readonly items: readonly TRaw[];
  readonly nextCursor?: string;
  readonly cacheHint?: IMCPResponseCacheHint;
}

/** Structural boundary conversion: the SDK's JSON-Schema-shaped `inputSchema` into our subset. */
function toParameterSchema(schema: Readonly<Record<string, unknown>>): IParameterSchema {
  return schema as unknown as IParameterSchema;
}

function mapTool(raw: TRawTool): IMCPDiscoveredTool {
  const resultSizeMetadata = parseMCPResultSizeMetadata(
    (raw as TRawTool & { readonly _meta?: unknown })._meta,
  );
  return {
    name: raw.name,
    description: raw.description,
    inputSchema: toParameterSchema(raw.inputSchema),
    outputSchema: raw.outputSchema === undefined ? undefined : toUniversalObject(raw.outputSchema),
    ...(resultSizeMetadata.kind === 'absent' ? {} : { resultSizeMetadata }),
  };
}

function mapPrompt(raw: TRawPrompt): IMCPDiscoveredPrompt {
  return {
    name: raw.name,
    description: raw.description,
    arguments: raw.arguments,
  };
}

function mapResource(raw: TRawResource): IMCPDiscoveredResource {
  return {
    uri: raw.uri,
    name: raw.name,
    description: raw.description,
    mimeType: raw.mimeType,
  };
}

function toDiscoveryError(
  domain: TMCPCapabilityDomain,
  error: unknown,
  pagesSeen: number,
): MCPDiscoveryError {
  if (error instanceof ProtocolError) {
    return new MCPDiscoveryError({
      kind: error.code === ProtocolErrorCode.InvalidParams ? 'invalid-cursor' : 'protocol',
      domain,
      message: error.message,
      code: error.code,
      pagesSeen,
    });
  }
  // The SDK reports an aborted request as a timeout too; the caller's signal tells them apart.
  if (isRequestTimeout(error)) {
    return new MCPDiscoveryError({
      kind: 'timeout',
      domain,
      message: error instanceof Error ? error.message : String(error),
      pagesSeen,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new MCPDiscoveryError({ kind: 'protocol', domain, message, pagesSeen });
}

function assertPageBoundNotExceeded(
  domain: TMCPCapabilityDomain,
  pages: number,
  maxPages: number,
): void {
  if (pages >= maxPages) {
    throw new MCPDiscoveryError({
      kind: 'page-bound-exceeded',
      domain,
      message: `Exceeded the configured page bound of ${maxPages} for "${domain}"`,
      pagesSeen: pages,
    });
  }
}

async function fetchPageOrThrow<TRaw>(
  domain: TMCPCapabilityDomain,
  pages: number,
  cursor: string | undefined,
  options: IMCPDiscoverOptions,
  listPage: (
    cursor: string | undefined,
    requestOptions: { readonly timeout: number; readonly signal?: AbortSignal },
  ) => Promise<IListPage<TRaw>>,
): Promise<IListPage<TRaw>> {
  try {
    return await listPage(cursor, {
      timeout: options.perRequestTimeoutMs,
      signal: options.signal,
    });
  } catch (error) {
    throw toDiscoveryError(domain, error, pages);
  }
}

/** The next cursor to follow, or `undefined` once the domain's pages are exhausted. */
function resolveNextCursor(
  domain: TMCPCapabilityDomain,
  pages: number,
  nextCursor: string | undefined,
): string | undefined {
  if (nextCursor === undefined) {
    return undefined;
  }
  if (nextCursor === '') {
    throw new MCPDiscoveryError({
      kind: 'invalid-cursor',
      domain,
      message: `Server returned an empty nextCursor for "${domain}"`,
      pagesSeen: pages,
    });
  }
  return nextCursor;
}

async function discoverDomain<TRaw, TItem>(
  domain: TMCPCapabilityDomain,
  declared: { readonly listChanged: boolean } | undefined,
  options: IMCPDiscoverOptions,
  listPage: (
    cursor: string | undefined,
    requestOptions: { readonly timeout: number; readonly signal?: AbortSignal },
  ) => Promise<IListPage<TRaw>>,
  map: (raw: TRaw) => TItem,
): Promise<IMCPDiscoveryDomainResult<TItem>> {
  if (declared === undefined) {
    return { state: { kind: 'unsupported' }, items: [], pages: 0 };
  }

  const items: TItem[] = [];
  const cacheHints: IMCPResponseCacheHint[] = [];
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    assertPageBoundNotExceeded(domain, pages, options.maxPages);

    const page = await fetchPageOrThrow(domain, pages, cursor, options, listPage);
    pages += 1;
    items.push(...page.items.map(map));
    if (page.cacheHint) cacheHints.push(page.cacheHint);

    const nextCursor = resolveNextCursor(domain, pages, page.nextCursor);
    if (nextCursor === undefined) {
      break;
    }
    cursor = nextCursor;
  }

  return {
    state: { kind: 'supported', count: items.length, listChanged: declared.listChanged },
    items,
    pages,
    ...(cacheHints.length === 0 ? {} : { cacheHints }),
  };
}

/** Paginated discovery over every domain the server declared; never reports a partial catalog. */
export async function discoverAll(
  client: IMCPDiscoveryClient,
  declaredCapabilities: TDeclaredCapabilities,
  identity: IMCPServerIdentity,
  instructions: string | undefined,
  options: IMCPDiscoverOptions,
): Promise<IMCPDiscovery> {
  const tools = await discoverDomain<TRawTool, IMCPDiscoveredTool>(
    'tools',
    declaredCapabilities.tools,
    options,
    async (cursor, requestOptions) => {
      const result = await client.request(
        { method: 'tools/list', params: cursor === undefined ? {} : { cursor } },
        requestOptions,
      );
      return {
        items: result.tools,
        nextCursor: result.nextCursor,
        ...(identity.protocolVersion === '2026-07-28'
          ? { cacheHint: statelessCacheHint(result) }
          : {}),
      };
    },
    mapTool,
  );

  const prompts = await discoverDomain<TRawPrompt, IMCPDiscoveredPrompt>(
    'prompts',
    declaredCapabilities.prompts,
    options,
    async (cursor, requestOptions) => {
      const result = await client.request(
        { method: 'prompts/list', params: cursor === undefined ? {} : { cursor } },
        requestOptions,
      );
      return {
        items: result.prompts,
        nextCursor: result.nextCursor,
        ...(identity.protocolVersion === '2026-07-28'
          ? { cacheHint: statelessCacheHint(result) }
          : {}),
      };
    },
    mapPrompt,
  );

  const resources = await discoverDomain<TRawResource, IMCPDiscoveredResource>(
    'resources',
    declaredCapabilities.resources,
    options,
    async (cursor, requestOptions) => {
      const result = await client.request(
        { method: 'resources/list', params: cursor === undefined ? {} : { cursor } },
        requestOptions,
      );
      return {
        items: result.resources,
        nextCursor: result.nextCursor,
        ...(identity.protocolVersion === '2026-07-28'
          ? { cacheHint: statelessCacheHint(result) }
          : {}),
      };
    },
    mapResource,
  );

  return { identity, instructions, tools, prompts, resources };
}
