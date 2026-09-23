import { describe, expect, it, vi } from 'vitest';

import {
  loadAnthropicModelEffortVerificationConfig,
  ANTHROPIC_MODEL_EFFORT_VERIFICATION_MODEL,
} from './model-effort-verification-config';

describe('loadAnthropicModelEffortVerificationConfig', () => {
  it('loads the ignored credential file while selecting Claude Sonnet 4.6 itself', () => {
    const environment: Record<string, string | undefined> = {};
    const loadEnvironmentFile = vi.fn(() => {
      environment.ANTHROPIC_API_KEY = 'test-key';
    });

    expect(
      loadAnthropicModelEffortVerificationConfig(
        environment,
        '/workspace/.env.local',
        () => true,
        loadEnvironmentFile,
      ),
    ).toEqual({
      apiKey: 'test-key',
      model: ANTHROPIC_MODEL_EFFORT_VERIFICATION_MODEL,
    });
    expect(loadEnvironmentFile).toHaveBeenCalledWith('/workspace/.env.local');
  });
});
