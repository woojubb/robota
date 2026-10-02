import { MCPSkillError, parseSkillEntry, verifySkillResource } from './manifest.js';
import { statelessCacheHint } from '../client/stateless-result.js';
import type { Result } from '@modelcontextprotocol/sdk/types.js';
import type { IMCPServerIdentity } from '../catalog/types.js';
import type { IMCPSkillEntry, IMCPSkillRequestOptions, IMCPSkillsSession } from './types.js';

type TRequest = (
  method: string,
  params: Record<string, unknown>,
  options?: IMCPSkillRequestOptions,
) => Promise<Result>;

/** An opt-in wire view. The host owns consent and activation; this view grants neither. */
export function createSkillsSession(
  identity: IMCPServerIdentity,
  request: TRequest,
): IMCPSkillsSession {
  const observed = new Map<string, IMCPSkillEntry>();
  const refreshes = new Map<string, number>();
  let epoch = 0;
  const reserve = (uri: string, refresh: number): void => {
    if ((refreshes.get(uri) ?? 0) > refresh) return;
    refreshes.set(uri, refresh);
    observed.delete(uri);
  };
  const complete = (result: Result): void => {
    if (result.resultType !== undefined && result.resultType !== 'complete')
      throw new MCPSkillError('invalid-manifest');
    statelessCacheHint(result);
  };
  return {
    async list(options) {
      if (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1)
        throw new MCPSkillError('page-bound');
      const refresh = ++epoch;
      const entries: IMCPSkillEntry[] = [];
      const uris = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < options.maxPages; page++) {
        const result = await request(
          'skills/list',
          cursor === undefined ? {} : { cursor },
          options,
        );
        complete(result);
        if (!Array.isArray(result.skills)) throw new MCPSkillError('invalid-manifest');
        for (const raw of result.skills) {
          if (
            typeof raw === 'object' &&
            raw !== null &&
            'uri' in raw &&
            typeof raw.uri === 'string'
          )
            reserve(raw.uri, refresh);
          const entry = parseSkillEntry(raw, identity);
          if (uris.has(entry.uri)) throw new MCPSkillError('invalid-manifest');
          uris.add(entry.uri);
          entries.push(entry);
        }
        if (result.nextCursor === undefined) {
          for (const entry of entries) {
            if (refreshes.get(entry.uri) === refresh)
              observed.set(entry.uri, structuredClone(entry));
          }
          return entries;
        }
        if (
          typeof result.nextCursor !== 'string' ||
          result.nextCursor.length === 0 ||
          cursors.has(result.nextCursor)
        )
          throw new MCPSkillError('invalid-manifest');
        cursor = result.nextCursor;
        cursors.add(cursor);
      }
      throw new MCPSkillError('page-bound');
    },
    async get(uri, options) {
      const refresh = ++epoch;
      reserve(uri, refresh);
      const result = await request('skills/get', { uri }, options);
      if (refreshes.get(uri) !== refresh) throw new MCPSkillError('changed-manifest');
      complete(result);
      const entry = parseSkillEntry(result.skill, identity);
      if (entry.uri !== uri) throw new MCPSkillError('invalid-manifest');
      observed.set(uri, structuredClone(entry));
      return entry;
    },
    async read(entry, uri, options) {
      const current = observed.get(entry.uri);
      if (
        !current ||
        entry.identity.serverId !== identity.serverId ||
        entry.identity.catalogGeneration !== identity.catalogGeneration ||
        current.manifestFingerprint !== entry.manifestFingerprint ||
        parseSkillEntry(entry, identity).manifestFingerprint !== current.manifestFingerprint
      )
        throw new MCPSkillError('changed-manifest');
      if (current.resources === 'dynamic') throw new MCPSkillError('unsupported-dynamic');
      if (!current.resources.some((file) => file.uri === uri))
        throw new MCPSkillError('missing-resource');
      try {
        const result = await request('resources/read', { uri }, options);
        if (
          (result.resultType !== undefined && result.resultType !== 'complete') ||
          !Array.isArray(result.contents) ||
          result.contents.length !== 1
        )
          throw new MCPSkillError('invalid-resource');
        const cacheHint = statelessCacheHint(result);
        // A concurrent refresh must not let an old approval use the old manifest after this await.
        if (observed.get(entry.uri)?.manifestFingerprint !== current.manifestFingerprint)
          throw new MCPSkillError('changed-manifest');
        return { ...verifySkillResource(current, uri, result.contents[0]), cacheHint };
      } catch (error) {
        if (observed.get(entry.uri)?.manifestFingerprint === current.manifestFingerprint)
          observed.delete(entry.uri);
        throw error;
      }
    },
  };
}

export function hasSkillsCapability(extensions: unknown): boolean {
  if (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions))
    return false;
  const value = (extensions as Record<string, unknown>)['io.modelcontextprotocol/skills'];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return !('directoryRead' in value) || typeof value.directoryRead === 'boolean';
}
