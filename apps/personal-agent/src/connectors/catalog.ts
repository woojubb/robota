/**
 * The services the add form can suggest: a file the owner may keep beside the agent's other state, and
 * the public MCP registry, asked only when the person searches. A suggestion is a set of values for the
 * add form and nothing more: adding it, signing in and what the agent may do with it stay the person's.
 * Everything here is text somebody else wrote, shown on the page and never given to the model.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalogEntriesFromRegistry, catalogEntryOf } from '@robota-sdk/agent-product/personal';

import type { IConnectorCatalogEntry } from '@robota-sdk/agent-product/personal';

export const REGISTRY_URL_VARIABLE = 'PERSONAL_AGENT_REGISTRY_URL';
export const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io';
const CATALOG_FILE = 'connector-catalog.json';
const MAX_QUERY = 100;
const PAGE_LIMIT = 30;
const MAX_FILE_ENTRIES = 200;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_MS = 5 * 60_000;
const MAX_CACHED_QUERIES = 30;

export interface IConnectorCatalogAnswer {
  readonly entries: readonly IConnectorCatalogEntry[];
  /** Whether the registry answered: `off` when the owner turned it off. */
  readonly registry: 'ok' | 'unreachable' | 'off';
}

export interface IConnectorCatalog {
  search(query: string): Promise<IConnectorCatalogAnswer>;
}

export interface IConnectorCatalogOptions {
  readonly stateDir: string;
  /** The registry's address; `null` turns the registry off, absent means the public one. */
  readonly registryUrl?: string | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

/**
 * The owner's setting for the registry: absent or blank is the public registry, `off` turns it off,
 * anything else must be an `https` address. A value that could never work is refused at start-up.
 */
export function registryUrlFrom(
  environment: Readonly<Record<string, string | undefined>>,
): string | null | undefined {
  const value = (environment[REGISTRY_URL_VARIABLE] ?? '').trim();
  if (value === '') return undefined;
  if (value.toLowerCase() === 'off') return null;
  if (!(URL.canParse(value) && new URL(value).protocol === 'https:')) {
    throw new Error(`${REGISTRY_URL_VARIABLE} must be an https address, or off`);
  }
  return value;
}

/** The entries of the owner's file; a missing or unreadable file offers nothing. */
function fileEntries(stateDir: string): IConnectorCatalogEntry[] {
  const path = join(stateDir, CATALOG_FILE);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // allow-fallback: a file the owner is still editing offers nothing until it parses again.
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
      ? (parsed as { entries?: unknown }).entries
      : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_FILE_ENTRIES)
    .map((raw) => catalogEntryOf(raw, 'file'))
    .filter((entry): entry is IConnectorCatalogEntry => entry !== undefined);
}

function matches(entry: IConnectorCatalogEntry, query: string): boolean {
  if (query === '') return true;
  const host = URL.canParse(entry.endpoint) ? new URL(entry.endpoint).hostname : '';
  return `${entry.title} ${entry.description ?? ''} ${host}`.toLowerCase().includes(query);
}

export function createConnectorCatalog(options: IConnectorCatalogOptions): IConnectorCatalog {
  const base = options.registryUrl === undefined ? DEFAULT_REGISTRY_URL : options.registryUrl;
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; entries: IConnectorCatalogEntry[] }>();

  const fromRegistry = async (
    registry: string,
    query: string,
  ): Promise<IConnectorCatalogEntry[]> => {
    const url = new URL('v0.1/servers', registry.endsWith('/') ? registry : `${registry}/`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('version', 'latest');
    if (query !== '') url.searchParams.set('search', query);
    const response = await fetchImpl(url.href, {
      headers: { accept: 'application/json' },
      // An answer is data to read, not a place to be sent on from.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('The registry did not answer');
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) throw new Error('The registry answer is too large');
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new Error('The registry answer is too large');
    return catalogEntriesFromRegistry(JSON.parse(body));
  };

  return {
    async search(rawQuery) {
      const query = rawQuery.trim().slice(0, MAX_QUERY).toLowerCase();
      const local = fileEntries(options.stateDir).filter((entry) => matches(entry, query));
      if (base === null) return { entries: local, registry: 'off' };
      let remote: IConnectorCatalogEntry[] = [];
      let registry: IConnectorCatalogAnswer['registry'] = 'ok';
      const cached = cache.get(query);
      if (cached !== undefined && now() - cached.at < CACHE_MS) {
        remote = cached.entries;
      } else {
        try {
          remote = await fromRegistry(base, query);
          if (cache.size >= MAX_CACHED_QUERIES) cache.delete(cache.keys().next().value as string);
          cache.set(query, { at: now(), entries: remote });
        } catch {
          // allow-fallback: an unreachable or misbehaving registry shows the owner's entries and says so.
          registry = 'unreachable';
        }
      }
      const seen = new Set(local.map((entry) => entry.endpoint));
      return {
        entries: [...local, ...remote.filter((entry) => !seen.has(entry.endpoint))],
        registry,
      };
    },
  };
}
