import { describe, expect, it, vi } from 'vitest';

import {
  loadGeminiModelEffortVerificationConfig,
  GEMINI_MODEL_EFFORT_VERIFICATION_MODEL,
} from './model-effort-verification-config';

describe('loadGeminiModelEffortVerificationConfig', () => {
  it('loads the ignored credential file while selecting Gemini 3 Flash Preview itself', () => {
    const environment: Record<string, string | undefined> = {};
    const loadEnvironmentFile = vi.fn(() => {
      environment.GEMINI_API_KEY = 'test-key';
    });

    expect(
      loadGeminiModelEffortVerificationConfig(
        environment,
        '/workspace/.env.local',
        () => true,
        loadEnvironmentFile,
      ),
    ).toEqual({
      apiKey: 'test-key',
      model: GEMINI_MODEL_EFFORT_VERIFICATION_MODEL,
    });
    expect(loadEnvironmentFile).toHaveBeenCalledWith('/workspace/.env.local');
  });
});
