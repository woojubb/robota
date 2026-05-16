import type {
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  IProviderProfileConfig,
} from '@robota-sdk/agent-core';
import { DEFAULT_DEEPSEEK_PROVIDER_BASE_URL } from './defaults';
import {
  DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
  DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  getDeepSeekFallbackModelCatalogEntry,
} from './model-catalog';

export interface IDeepSeekModelsResponse {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
}

export interface IDeepSeekFetchInit {
  headers?: Record<string, string>;
}

export interface IDeepSeekFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<IDeepSeekModelsResponse>;
}

export type TDeepSeekFetch = (
  url: string,
  init?: IDeepSeekFetchInit,
) => Promise<IDeepSeekFetchResponse>;

export async function refreshDeepSeekModelCatalog(
  profile: IProviderProfileConfig,
  fetcher: TDeepSeekFetch = defaultDeepSeekFetch,
): Promise<IProviderModelCatalog> {
  const baseURL = trimTrailingSlash(profile.baseURL ?? DEFAULT_DEEPSEEK_PROVIDER_BASE_URL);
  const url = `${baseURL}/models`;
  const response = await fetcher(url, buildFetchInit(profile.apiKey));

  if (!response.ok) {
    return {
      status: 'unavailable',
      sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
      message: `DeepSeek model refresh failed: HTTP ${response.status}`,
    };
  }

  const body = await response.json();
  const entries = (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map(toModelCatalogEntry);

  return {
    status: 'live',
    sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
    lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
    entries,
  };
}

function buildFetchInit(apiKey: string | undefined): IDeepSeekFetchInit | undefined {
  if (!apiKey) {
    return undefined;
  }
  return {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

function toModelCatalogEntry(id: string): IProviderModelCatalogEntry {
  return (
    getDeepSeekFallbackModelCatalogEntry(id) ?? {
      id,
      displayName: id,
      lifecycle: 'active',
      sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
      lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
    }
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

async function defaultDeepSeekFetch(
  url: string,
  init?: IDeepSeekFetchInit,
): Promise<IDeepSeekFetchResponse> {
  const response = await fetch(url, {
    ...(init?.headers !== undefined && { headers: init.headers }),
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<IDeepSeekModelsResponse>,
  };
}
