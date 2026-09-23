import { describe, expect, it, vi } from 'vitest';

import {
  loadVercelAiGatewayModelEffortConfig,
  resolveVercelAiGatewayModelEffortConfig,
  VERCEL_AI_GATEWAY_BASE_URL,
  VERCEL_AI_GATEWAY_MODEL,
} from './model-effort-verification-config';

describe('resolveVercelAiGatewayModelEffortConfig', () => {
  it('uses the Gateway credential while selecting the model itself', () => {
    expect(resolveVercelAiGatewayModelEffortConfig({ AI_GATEWAY_API_KEY: 'test-key' })).toEqual({
      apiKey: 'test-key',
      baseURL: VERCEL_AI_GATEWAY_BASE_URL,
      model: VERCEL_AI_GATEWAY_MODEL,
    });
  });

  it('rejects a missing Gateway credential without accepting a user-supplied model', () => {
    expect(() => resolveVercelAiGatewayModelEffortConfig({})).toThrow(
      'AI_GATEWAY_API_KEY is required',
    );
  });

  it('loads the ignored environment file before resolving the Gateway credential', () => {
    const environment: Record<string, string | undefined> = {};
    const loadEnvironmentFile = vi.fn(() => {
      environment.AI_GATEWAY_API_KEY = 'test-key';
    });

    expect(
      loadVercelAiGatewayModelEffortConfig(
        environment,
        '/workspace/.env.local',
        () => true,
        loadEnvironmentFile,
      ),
    ).toMatchObject({
      apiKey: 'test-key',
      baseURL: VERCEL_AI_GATEWAY_BASE_URL,
      model: VERCEL_AI_GATEWAY_MODEL,
    });
    expect(loadEnvironmentFile).toHaveBeenCalledWith('/workspace/.env.local');
  });
});
