import type {
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  IProviderProfileConfig,
} from '@robota-sdk/agent-core';

const OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const OPENAI_MODELS_SOURCE_URL = 'https://platform.openai.com/docs/api-reference/models/list';

export interface IOpenAIModelCatalogResponse {
  data?: readonly IOpenAIModelCatalogResource[];
}

export interface IOpenAIModelCatalogResource {
  id?: string;
}

export interface IOpenAIModelCatalogFetchInit {
  headers: Record<string, string>;
}

export interface IOpenAIModelCatalogFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<IOpenAIModelCatalogResponse>;
}

export type TOpenAIModelCatalogFetch = (
  url: string,
  init: IOpenAIModelCatalogFetchInit,
) => Promise<IOpenAIModelCatalogFetchResponse>;

export interface IRefreshOpenAIModelCatalogOptions {
  fetcher?: TOpenAIModelCatalogFetch;
  now?: () => Date;
}

export async function refreshOpenAIModelCatalog(
  profile: IProviderProfileConfig,
  options: IRefreshOpenAIModelCatalogOptions = {},
): Promise<IProviderModelCatalog> {
  if (!profile.apiKey) {
    return createUnavailableCatalog('OpenAI model catalog refresh requires apiKey.');
  }

  const fetcher = options.fetcher ?? defaultOpenAIModelCatalogFetch;
  const now = options.now ?? (() => new Date());
  const url = resolveModelsEndpoint(profile.baseURL);

  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${profile.apiKey}` },
    });
    if (!response.ok) {
      return createUnavailableCatalog(formatHttpFailure(response));
    }

    const body = await response.json();
    const entries = toModelCatalogEntries(body);
    return {
      status: 'live',
      entries,
      lastVerifiedAt: now().toISOString(),
      sourceUrl: OPENAI_MODELS_SOURCE_URL,
      message: `${entries.length} OpenAI model(s) discovered.`,
    };
  } catch (error) {
    return createUnavailableCatalog(error instanceof Error ? error.message : String(error));
  }
}

function resolveModelsEndpoint(baseURL: string | undefined): string {
  if (!baseURL) return OPENAI_MODELS_ENDPOINT;
  return `${baseURL.replace(/\/$/, '')}/models`;
}

function toModelCatalogEntries(
  body: IOpenAIModelCatalogResponse,
): readonly IProviderModelCatalogEntry[] {
  return (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => id !== undefined && id.trim().length > 0)
    .map((id) => ({
      id,
      displayName: id,
      lifecycle: 'active',
    }));
}

function formatHttpFailure(response: IOpenAIModelCatalogFetchResponse): string {
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return `OpenAI model catalog refresh failed: HTTP ${response.status}${statusText}`;
}

function createUnavailableCatalog(message: string): IProviderModelCatalog {
  return {
    status: 'unavailable',
    sourceUrl: OPENAI_MODELS_SOURCE_URL,
    message,
  };
}

async function defaultOpenAIModelCatalogFetch(
  url: string,
  init: IOpenAIModelCatalogFetchInit,
): Promise<IOpenAIModelCatalogFetchResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<IOpenAIModelCatalogResponse>,
  };
}
