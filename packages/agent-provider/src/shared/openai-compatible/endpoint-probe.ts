import type { IProviderProfileConfig, IProviderProbeResult } from '@robota-sdk/agent-core';

export interface IOpenAICompatibleModelsResponse {
  data?: Array<{ id?: string }>;
}

export interface IOpenAICompatibleFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<IOpenAICompatibleModelsResponse>;
}

export type TOpenAICompatibleFetch = (url: string) => Promise<IOpenAICompatibleFetchResponse>;

export async function probeOpenAICompatibleProfile(
  profile: IProviderProfileConfig,
  fetcher: TOpenAICompatibleFetch = defaultOpenAICompatibleFetch,
): Promise<IProviderProbeResult> {
  if (!profile.baseURL) {
    return { ok: true, message: 'Profile fields are valid; no endpoint probe configured.' };
  }

  try {
    const response = await fetcher(`${profile.baseURL.replace(/\/$/, '')}/models`);
    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` };
    }
    const body = await response.json();
    const models = (body.data ?? []).map((item) => item.id).filter((id): id is string => !!id);
    return { ok: true, message: `${models.length} model(s) discovered`, models };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function defaultOpenAICompatibleFetch(url: string): Promise<IOpenAICompatibleFetchResponse> {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<IOpenAICompatibleModelsResponse>,
  };
}
