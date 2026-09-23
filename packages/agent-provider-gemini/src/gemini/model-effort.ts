import {
  resolveModelEffort,
  type IChatOptions,
  type IModelEffortResolution,
  type IProviderModelEffortTable,
  type TModelEffort,
  type TTextDeltaCallback,
} from '@robota-sdk/agent-core';

import type { IGeminiThinkingConfig } from './types';

/**
 * Generate Content effort capabilities verified against
 * https://ai.google.dev/gemini-api/docs/generate-content/thinking on 2026-09-11.
 *
 * Gemini 2.5 exposes a numeric `thinkingBudget`; this adapter deliberately does
 * not invent an ordinal-to-budget conversion, so only verified `thinkingLevel`
 * models appear here.
 */
export const GEMINI_MODEL_EFFORT_TABLE: IProviderModelEffortTable = {
  verifiedAt: '2026-09-11',
  sourceUrl: 'https://ai.google.dev/gemini-api/docs/generate-content/thinking',
  models: {
    'gemini-3-flash-preview': {
      supportedEfforts: ['minimal', 'low', 'medium', 'high'],
      defaultEffort: 'high',
      nativeControlId: 'thinkingConfig.thinkingLevel',
    },
    'gemini-3-pro-preview': {
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'high',
      nativeControlId: 'thinkingConfig.thinkingLevel',
    },
  },
};

export function resolveGeminiEffortOptions(
  options: IChatOptions | undefined,
  defaultModel: string | undefined,
): IChatOptions | undefined {
  if (options?.effort === undefined || options.effortResolution !== undefined) return options;
  const model = options.model ?? defaultModel;
  if (model === undefined) return options;
  return {
    ...options,
    effortResolution: resolveModelEffort(GEMINI_MODEL_EFFORT_TABLE, model, options.effort),
  };
}

export function withGeminiTextDeltaCallback(
  options: IChatOptions | undefined,
  onTextDelta: TTextDeltaCallback | undefined,
): IChatOptions | undefined {
  const callback = options?.onTextDelta ?? onTextDelta;
  return callback === undefined ? options : { ...options, onTextDelta: callback };
}

/**
 * Merge a verified Core resolution into the provider's static thinking config.
 * A request can use exactly one native thinking control; a static level/budget
 * that would alter the semantic outcome is rejected rather than overwritten.
 */
export function resolveGeminiThinkingConfig(
  staticConfig: IGeminiThinkingConfig | undefined,
  resolution: IModelEffortResolution | undefined,
): IGeminiThinkingConfig | undefined {
  if (resolution === undefined) return staticConfig;

  const hasStaticControl =
    staticConfig?.thinkingLevel !== undefined || staticConfig?.thinkingBudget !== undefined;
  if (resolution.effective === null || resolution.disposition === 'model-default') {
    if (hasStaticControl) {
      throw new Error(
        'Automatic or unverified effort conflicts with a static Gemini thinking control.',
      );
    }
    return staticConfig;
  }

  const thinkingLevel = mapEffortToGeminiThinkingLevel(resolution.effective);
  if (staticConfig?.thinkingBudget !== undefined) {
    throw new Error(
      'Resolved Gemini thinkingLevel cannot coexist with static thinkingConfig.thinkingBudget.',
    );
  }
  if (staticConfig?.thinkingLevel !== undefined && staticConfig.thinkingLevel !== thinkingLevel) {
    throw new Error(
      `Resolved effort ${thinkingLevel} conflicts with static thinkingConfig.thinkingLevel ${staticConfig.thinkingLevel}.`,
    );
  }
  return { ...staticConfig, thinkingLevel };
}

function mapEffortToGeminiThinkingLevel(effort: TModelEffort): string {
  switch (effort) {
    case 'minimal':
      return 'MINIMAL';
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'HIGH';
    case 'none':
      throw new Error('Gemini does not support thinkingLevel=none.');
  }
}
