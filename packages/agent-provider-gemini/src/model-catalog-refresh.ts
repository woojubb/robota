import type {
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  IProviderProfileConfig,
} from '@robota-sdk/agent-core';
import { GEMINI_MODEL_LAST_VERIFIED_AT, GEMINI_MODEL_SOURCE_URL } from './provider-definition';

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface IGeminiModelInfo {
  name?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export interface IGeminiModelsResponse {
  models?: IGeminiModelInfo[];
  nextPageToken?: string;
}

export interface IGeminiFetchInit {
  headers?: Record<string, string>;
}

export interface IGeminiFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<IGeminiModelsResponse>;
}

export type TGeminiFetch = (url: string, init?: IGeminiFetchInit) => Promise<IGeminiFetchResponse>;

export async function refreshGeminiModelCatalog(
  profile: IProviderProfileConfig,
  fetcher: TGeminiFetch = defaultGeminiFetch,
): Promise<IProviderModelCatalog> {
  const url = profile.apiKey ? `${GEMINI_API_ENDPOINT}?key=${profile.apiKey}` : GEMINI_API_ENDPOINT;

  const response = await fetcher(url);

  if (!response.ok) {
    return {
      status: 'unavailable',
      sourceUrl: GEMINI_MODEL_SOURCE_URL,
      message: `Gemini model refresh failed: HTTP ${response.status}`,
    };
  }

  const body = await response.json();
  const entries = (body.models ?? []).filter(supportsGenerateContent).map(toModelCatalogEntry);

  return {
    status: 'live',
    sourceUrl: GEMINI_MODEL_SOURCE_URL,
    lastVerifiedAt: new Date().toISOString(),
    entries,
    message: `Fetched ${entries.length} Gemini models`,
  };
}

function supportsGenerateContent(model: IGeminiModelInfo): boolean {
  return model.supportedGenerationMethods?.includes('generateContent') === true;
}

function toModelCatalogEntry(model: IGeminiModelInfo): IProviderModelCatalogEntry {
  const rawName = model.name ?? '';
  const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
  const lifecycle = rawName.includes('preview') ? 'preview' : 'active';

  return {
    id,
    displayName: model.displayName ?? id,
    lifecycle,
    sourceUrl: GEMINI_MODEL_SOURCE_URL,
    lastVerifiedAt: GEMINI_MODEL_LAST_VERIFIED_AT,
  };
}

async function defaultGeminiFetch(
  url: string,
  _init?: IGeminiFetchInit,
): Promise<IGeminiFetchResponse> {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<IGeminiModelsResponse>,
  };
}
