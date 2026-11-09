import type { IProviderModelEffortTable } from '@robota-sdk/agent-core';

/**
 * Anthropic Messages API effort capabilities verified against
 * https://platform.claude.com/docs/en/build-with-claude/effort on 2026-09-11.
 *
 * The vendor documents `max` for Opus 4.5/4.6 and Sonnet 4.6, but reserves
 * `xhigh` for newer model families. Unknown models deliberately have no entry.
 */
export const ANTHROPIC_MODEL_EFFORT_TABLE: IProviderModelEffortTable = {
  verifiedAt: '2026-09-11',
  sourceUrl: 'https://platform.claude.com/docs/en/build-with-claude/effort',
  models: {
    'claude-opus-4-5': {
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      nativeControlId: 'output_config.effort',
    },
    'claude-opus-4-5-20251101': {
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      nativeControlId: 'output_config.effort',
    },
    'claude-opus-4-6': {
      supportedEfforts: ['low', 'medium', 'high', 'max'],
      defaultEffort: 'high',
      nativeControlId: 'output_config.effort',
    },
    'claude-sonnet-4-6': {
      supportedEfforts: ['low', 'medium', 'high', 'max'],
      defaultEffort: 'high',
      nativeControlId: 'output_config.effort',
    },
  },
};
