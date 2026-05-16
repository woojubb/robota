import type {
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  IProviderProfileConfig,
} from '@robota-sdk/agent-core';
import {
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  QWEN_MODEL_LAST_VERIFIED_AT,
  QWEN_MODEL_SOURCE_URL,
} from './defaults';

export interface IQwenModelsResponse {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
}

export interface IQwenFetchInit {
  headers?: Record<string, string>;
}

export interface IQwenFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<IQwenModelsResponse>;
}

export type TQwenFetch = (url: string, init?: IQwenFetchInit) => Promise<IQwenFetchResponse>;

export async function refreshQwenModelCatalog(
  profile: IProviderProfileConfig,
  fetcher: TQwenFetch = defaultQwenFetch,
): Promise<IProviderModelCatalog> {
  const baseURL = trimTrailingSlash(profile.baseURL ?? DEFAULT_QWEN_PROVIDER_BASE_URL);
  const url = `${baseURL}/models`;
  const response = await fetcher(url, buildFetchInit(profile.apiKey));

  if (!response.ok) {
    return {
      status: 'unavailable',
      sourceUrl: QWEN_MODEL_SOURCE_URL,
      message: `Qwen model refresh failed: HTTP ${response.status}`,
    };
  }

  const body = await response.json();
  const entries = (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map(toModelCatalogEntry);

  return {
    status: 'live',
    sourceUrl: QWEN_MODEL_SOURCE_URL,
    lastVerifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
    entries,
    message: `Loaded ${entries.length} models from Qwen API`,
  };
}

function buildFetchInit(apiKey: string | undefined): IQwenFetchInit | undefined {
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
  return {
    id,
    displayName: id,
    lifecycle: 'active',
    sourceUrl: QWEN_MODEL_SOURCE_URL,
    lastVerifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

async function defaultQwenFetch(url: string, init?: IQwenFetchInit): Promise<IQwenFetchResponse> {
  const response = await fetch(url, {
    ...(init?.headers !== undefined && { headers: init.headers }),
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<IQwenModelsResponse>,
  };
}
