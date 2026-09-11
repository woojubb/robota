import type { IProviderModelEffortTable } from '@robota-sdk/agent-core';

/**
 * Exact model facts verified against OpenAI's Responses reference on 2026-09-11.
 *
 * The adapter deliberately declares no prefix or vendor-wide fallback. A different model id must
 * remain `not-applied` until its documented controls and default are added here.
 */
export const OPENAI_MODEL_EFFORT_TABLE: IProviderModelEffortTable = {
  verifiedAt: '2026-09-11',
  sourceUrl: 'https://platform.openai.com/docs/api-reference/responses',
  models: {
    'gpt-5.1': {
      supportedEfforts: ['none', 'low', 'medium', 'high'],
      defaultEffort: 'none',
      nativeControlId: 'responses.reasoning.effort',
    },
  },
};
