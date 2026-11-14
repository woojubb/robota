/**
 * The personal agent's own API for its web UI: the library (knowledge wiki), search and settings.
 * The shared loopback GUI server reaches it only for the browser holding the access cookie, and only
 * with the write header for anything that changes state, so this module decides what, not who.
 *
 * What a person types here is the person's own word: a fact added or corrected from the page is
 * filed with origin `owner`. The provider key never passes through: settings name the environment
 * variable that holds it.
 */
import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import { PAGE_KINDS, SensitiveContentRefusedError } from '@robota-sdk/agent-product/personal';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider/builtin';

import { loadConfig, saveConfig } from './config.js';
import { createProviderFromProfile } from './provider.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type { IWikiPage, KnowledgeWiki, TPageKind } from '@robota-sdk/agent-product/personal';
import type { IProviderProfile } from './config.js';

export interface IPersonalApiOptions {
  readonly wiki: KnowledgeWiki;
  readonly stateDir: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Whether the agent has a browser on this machine. */
  readonly browserAvailable: () => boolean;
}

export type TPersonalApi = (request: ILoopbackGuiApiRequest) => Promise<ILoopbackGuiApiResponse>;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

class BadRequest extends Error {}

const ok = (body: unknown): ILoopbackGuiApiResponse => ({ status: 200, body });
const fail = (status: number, error: string): ILoopbackGuiApiResponse => ({ status, body: { error } });

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('expected a JSON object');
  return body as Record<string, unknown>;
}

function text(body: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = body[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || value.trim() === '') throw new BadRequest(`${key} must be a non-empty string`);
  return value;
}

function summary(page: IWikiPage) {
  return {
    id: page.id,
    title: page.title,
    kind: page.kind,
    currentClaims: page.claims.filter((claim) => claim.validTo === undefined).length,
    updatedAt: page.updatedAt,
  };
}

export function providerTypes(): string[] {
  return createDefaultProviderDefinitions().map((definition) => definition.type);
}

export function createPersonalApi(options: IPersonalApiOptions): TPersonalApi {
  const { wiki } = options;

  const routes = async (request: ILoopbackGuiApiRequest): Promise<ILoopbackGuiApiResponse> => {
    const { method, segments } = request;
    const [area, collection, id, child] = segments;

    if (area === 'wiki' && collection === 'pages' && id === undefined) {
      if (method === 'GET') return ok({ pages: (await wiki.list()).map(summary) });
      if (method === 'POST') {
        const body = record(request.body);
        const kind = text(body, 'kind')!;
        if (!PAGE_KINDS.includes(kind as TPageKind)) throw new BadRequest(`kind must be one of ${PAGE_KINDS.join(', ')}`);
        const filed = await wiki.remember({
          pageTitle: text(body, 'title')!,
          kind: kind as TPageKind,
          claim: text(body, 'text')!,
          source: { origin: 'owner' },
        });
        return ok({ pageId: filed.pageId });
      }
    }
    if (area === 'wiki' && collection === 'pages' && id !== undefined) {
      const page = await wiki.read(id);
      if (page === undefined) return fail(404, 'no such page');
      if (child === undefined && method === 'GET') return ok({ page });
      if (child === 'claims' && method === 'POST') {
        const body = record(request.body);
        const supersedes = text(body, 'supersedes', true);
        const filed = await wiki.remember({
          pageTitle: page.title,
          claim: text(body, 'text')!,
          source: { origin: 'owner' },
          ...(supersedes !== undefined && { supersedes }),
        });
        return ok({ claimId: filed.claimId });
      }
    }
    if (area === 'wiki' && collection === 'forget' && method === 'POST') {
      const body = record(request.body);
      const claimId = text(body, 'claimId', true);
      const pageId = text(body, 'pageId', true);
      if ((claimId === undefined) === (pageId === undefined)) throw new BadRequest('give exactly one of claimId and pageId');
      const removed = await wiki.forget(claimId !== undefined ? { claimId } : { pageId: pageId! });
      return ok({ removed });
    }
    if (area === 'wiki' && collection === 'log' && method === 'GET') return ok({ entries: await wiki.log() });
    if (area === 'wiki' && collection === 'lint' && method === 'GET') return ok(await wiki.lint());

    if (area === 'search' && method === 'GET') {
      const query = (request.query.get('q') ?? '').trim();
      if (query === '') return ok({ results: [] });
      const words = query.toLowerCase().split(/\s+/u);
      const hits = await wiki.search(query, 20);
      return ok({
        results: hits.map((hit) => ({
          page: summary(hit.page),
          matches: hit.page.claims
            .filter((claim) => claim.validTo === undefined && words.some((word) => claim.text.toLowerCase().includes(word)))
            .map((claim) => claim.text),
        })),
      });
    }

    if (area === 'settings' && collection === undefined && method === 'GET') {
      const { provider } = loadConfig(options.stateDir);
      return ok({
        ...(provider !== undefined && { provider }),
        providerTypes: providerTypes(),
        stateDir: options.stateDir,
        browser: { available: options.browserAvailable() },
      });
    }
    if (area === 'settings' && collection === 'provider' && method === 'PUT') {
      const body = record(request.body);
      const type = text(body, 'type')!;
      const definitions = createDefaultProviderDefinitions();
      if (findProviderDefinition(definitions, type) === undefined) {
        throw new BadRequest(`unknown provider type; supported: ${formatSupportedProviderTypes(definitions)}`);
      }
      const baseURL = text(body, 'baseURL', true);
      const apiKeyEnv = text(body, 'apiKeyEnv', true);
      if (baseURL !== undefined && !URL.canParse(baseURL)) throw new BadRequest('baseURL must be a URL');
      if (apiKeyEnv !== undefined && !ENV_NAME.test(apiKeyEnv)) throw new BadRequest('apiKeyEnv must be an environment variable name');
      const provider: IProviderProfile = {
        type,
        model: text(body, 'model')!,
        ...(baseURL !== undefined && { baseURL }),
        ...(apiKeyEnv !== undefined && { apiKeyEnv }),
      };
      try {
        // Built once so a profile that cannot work is refused now, not at the next start.
        createProviderFromProfile(provider, options.environment);
      } catch (error) {
        throw new BadRequest(error instanceof Error ? error.message : String(error));
      }
      saveConfig(options.stateDir, { ...loadConfig(options.stateDir), provider });
      return ok({ saved: true, restartRequired: true });
    }
    return fail(404, 'not found');
  };

  return async (request) => {
    try {
      return await routes(request);
    } catch (error) {
      if (error instanceof BadRequest) return fail(400, error.message);
      if (error instanceof SensitiveContentRefusedError) return fail(422, error.message);
      if (error instanceof Error && /^No (current claim|wiki page)/u.test(error.message)) return fail(400, error.message);
      throw error;
    }
  };
}
