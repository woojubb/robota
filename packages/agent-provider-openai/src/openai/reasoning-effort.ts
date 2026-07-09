import type { IOpenAIResponsesReasoningOptions } from './types';
import type { TModelEffort } from '@robota-sdk/agent-core';

/**
 * Map the framework's per-call reasoning-effort dial onto the OpenAI Responses API
 * `reasoning.effort` parameter.
 *
 * OpenAI's native effort enum is `'low' | 'medium' | 'high'`. The framework union also
 * carries the long-running tiers `'xhigh'` and `'max'`; both clamp to OpenAI's highest
 * supported tier (`'high'`) since the Responses API has no stronger setting.
 */
export function mapEffortToOpenAIReasoningEffort(
  effort: TModelEffort,
): IOpenAIResponsesReasoningOptions['effort'] {
  switch (effort) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high';
    default: {
      // Exhaustiveness guard — a new TModelEffort member must extend this mapping.
      const exhaustive: never = effort;
      return exhaustive;
    }
  }
}

/**
 * Merge the per-call effort dial into the provider's static reasoning options.
 *
 * Per-call effort takes precedence over any static `reasoning.effort`; other static
 * reasoning fields (e.g. `summary`) are preserved. Returns `undefined` when neither a
 * per-call effort nor static reasoning options are present, so no `reasoning` key is
 * emitted on the request.
 */
export function resolveOpenAIReasoningOptions(
  staticReasoning: IOpenAIResponsesReasoningOptions | undefined,
  effort: TModelEffort | undefined,
): IOpenAIResponsesReasoningOptions | undefined {
  if (effort === undefined) {
    return staticReasoning;
  }
  return {
    ...staticReasoning,
    effort: mapEffortToOpenAIReasoningEffort(effort),
  };
}
