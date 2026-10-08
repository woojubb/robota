import { isEnvReference } from '@robota-sdk/agent-core';

import { probeOpenAICompatibleProfile } from '../shared/openai-compatible/endpoint-probe';

import type { IProviderProfileConfig, IProviderProbeResult } from '@robota-sdk/agent-core';
import type { IOpenAICompatibleModelsResponse } from '../shared/openai-compatible/endpoint-probe';

export async function probeGemmaProfile(
  profile: IProviderProfileConfig,
): Promise<IProviderProbeResult> {
  if (profile.apiKey !== undefined && isEnvReference(profile.apiKey)) {
    return { ok: false, message: 'The configured API key reference must be resolved by the host.' };
  }
  let authenticationStatus: number | undefined;
  const result = await probeOpenAICompatibleProfile(profile, async (url) => {
    const response = await fetch(url, {
      ...(profile.apiKey ? { headers: { Authorization: `Bearer ${profile.apiKey}` } } : {}),
    });
    if (response.status === 401 || response.status === 403) authenticationStatus = response.status;
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json() as Promise<IOpenAICompatibleModelsResponse>,
    };
  });
  return authenticationStatus === undefined
    ? result
    : {
        ok: false,
        message: `HTTP ${authenticationStatus}: the server rejected authentication. Add or update the optional server API key.`,
      };
}
