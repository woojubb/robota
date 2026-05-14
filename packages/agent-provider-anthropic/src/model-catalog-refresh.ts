import type {
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  IProviderProfileConfig,
} from '@robota-sdk/agent-core';
import {
  ANTHROPIC_MODEL_SOURCE_URL,
  ANTHROPIC_MODEL_LAST_VERIFIED_AT,
} from './provider-definition';

const ANTHROPIC_MODELS_API_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_API_VERSION = '2023-06-01';

export interface IAnthropicModelsResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
    type?: string;
  }>;
  has_more?: boolean;
}

export interface IAnthropicFetchInit {
  headers?: Record<string, string>;
}

export interface IAnthropicFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<IAnthropicModelsResponse>;
}

export type TAnthropicFetch = (
  url: string,
  init?: IAnthropicFetchInit,
) => Promise<IAnthropicFetchResponse>;

export async function refreshAnthropicModelCatalog(
  profile: IProviderProfileConfig,
  fetcher: TAnthropicFetch = defaultAnthropicFetch,
): Promise<IProviderModelCatalog> {
  return fetchModelCatalog(profile, fetcher);
}

async function fetchModelCatalog(
  profile: IProviderProfileConfig,
  fetcher: TAnthropicFetch,
): Promise<IProviderModelCatalog> {
  const response = await fetcher(ANTHROPIC_MODELS_API_URL, buildFetchInit(profile.apiKey)).catch(
    (err: unknown) => {
      // allow-fallback: catalog refresh is non-terminal; callers expect IProviderModelCatalog
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false as const,
        status: 0,
        json: (): Promise<IAnthropicModelsResponse> => Promise.resolve({ data: [] }),
        errorMessage: `Anthropic model refresh failed: ${message}`,
      };
    },
  );

  if ('errorMessage' in response) {
    return {
      status: 'unavailable',
      sourceUrl: ANTHROPIC_MODEL_SOURCE_URL,
      message: response.errorMessage,
    };
  }

  if (!response.ok) {
    return {
      status: 'unavailable',
      sourceUrl: ANTHROPIC_MODEL_SOURCE_URL,
      message: `Anthropic model refresh failed: HTTP ${response.status}`,
    };
  }

  const body = await response.json();
  const now = new Date().toISOString();
  const entries: IProviderModelCatalogEntry[] = (body.data ?? [])
    .filter(
      (item): item is { id: string; display_name?: string; type?: string } =>
        typeof item.id === 'string' && item.id.length > 0,
    )
    .map(
      (item): IProviderModelCatalogEntry => ({
        id: item.id,
        displayName: item.display_name ?? item.id,
        lifecycle: 'active',
        sourceUrl: ANTHROPIC_MODEL_SOURCE_URL,
        lastVerifiedAt: now,
      }),
    );

  return {
    status: 'live',
    sourceUrl: ANTHROPIC_MODEL_SOURCE_URL,
    lastVerifiedAt: ANTHROPIC_MODEL_LAST_VERIFIED_AT,
    entries,
    message: `Fetched ${entries.length} models from Anthropic API`,
  };
}

function buildFetchInit(apiKey: string | undefined): IAnthropicFetchInit | undefined {
  if (!apiKey) {
    return undefined;
  }
  return {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
  };
}

async function defaultAnthropicFetch(
  url: string,
  init?: IAnthropicFetchInit,
): Promise<IAnthropicFetchResponse> {
  const response = await fetch(url, {
    ...(init?.headers !== undefined && { headers: init.headers }),
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<IAnthropicModelsResponse>,
  };
}
