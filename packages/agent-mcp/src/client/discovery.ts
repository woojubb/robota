/**
 * Caller-owned pagination driver for MCP discovery (MCP-002, TC-02, TC-04, TC-19).
 *
 * For each domain the server never declared, the corresponding `list<Domain>` method is NEVER
 * called — the domain surfaces as `{ state: { kind: 'unsupported' }, items: [], pages: 0 }` (TC-04).
 * For a declared domain, pages are drained by following `nextCursor` until it is ABSENT
 * (`undefined`); a present-but-empty cursor is treated as invalid, never as "no more pages". A
 * catalog is never returned partial: any failure throws `MCPDiscoveryError` instead of resolving
 * with what was gathered so far.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { parseMCPResultSizeMetadata } from '../catalog/result-size-metadata.js';
import { MCPDiscoveryError } from '../catalog/types.js';
import { toUniversalObject } from '../catalog/universal-value.js';

import type { IMCPDiscoverOptions } from './session.js';
import type {
  IMCPDiscoveredPrompt,
  IMCPDiscoveredResource,
  IMCPDiscoveredTool,
  IMCPDiscovery,
  IMCPDiscoveryDomainResult,
  IMCPServerIdentity,
  TMCPCapabilityDomain,
} from '../catalog/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { IParameterSchema } from '@robota-sdk/agent-core';

type TDeclaredCapabilities = Readonly<
  Record<TMCPCapabilityDomain, { readonly listChanged: boolean } | undefined>
>;

type TRawTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
type TRawPrompt = Awaited<ReturnType<Client['listPrompts']>>['prompts'][number];
type TRawResource = Awaited<ReturnType<Client['listResources']>>['resources'][number];

interface IListPage<TRaw> {
  readonly items: readonly TRaw[];
  readonly nextCursor?: string;
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
  if (error instanceof McpError) {
    if (error.code === ErrorCode.InvalidParams) {
      return new MCPDiscoveryError({
        kind: 'invalid-cursor',
        domain,
        message: error.message,
        code: error.code,
        pagesSeen,
      });
    }
    if (error.code === ErrorCode.RequestTimeout) {
      return new MCPDiscoveryError({
        kind: 'timeout',
        domain,
        message: error.message,
        code: error.code,
        pagesSeen,
      });
    }
    return new MCPDiscoveryError({
      kind: 'protocol',
      domain,
      message: error.message,
      code: error.code,
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
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    assertPageBoundNotExceeded(domain, pages, options.maxPages);

    const page = await fetchPageOrThrow(domain, pages, cursor, options, listPage);
    pages += 1;
    items.push(...page.items.map(map));

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
  };
}

/** Paginated discovery over every domain the server declared; never reports a partial catalog. */
export async function discoverAll(
  client: Client,
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
      const result = await client.listTools(
        cursor === undefined ? undefined : { cursor },
        requestOptions,
      );
      return { items: result.tools, nextCursor: result.nextCursor };
    },
    mapTool,
  );

  const prompts = await discoverDomain<TRawPrompt, IMCPDiscoveredPrompt>(
    'prompts',
    declaredCapabilities.prompts,
    options,
    async (cursor, requestOptions) => {
      const result = await client.listPrompts(
        cursor === undefined ? undefined : { cursor },
        requestOptions,
      );
      return { items: result.prompts, nextCursor: result.nextCursor };
    },
    mapPrompt,
  );

  const resources = await discoverDomain<TRawResource, IMCPDiscoveredResource>(
    'resources',
    declaredCapabilities.resources,
    options,
    async (cursor, requestOptions) => {
      const result = await client.listResources(
        cursor === undefined ? undefined : { cursor },
        requestOptions,
      );
      return { items: result.resources, nextCursor: result.nextCursor };
    },
    mapResource,
  );

  return { identity, instructions, tools, prompts, resources };
}
