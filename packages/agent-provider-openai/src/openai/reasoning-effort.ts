import type { IOpenAIResponsesReasoningOptions } from './types';
import type { IModelEffortResolution, TModelEffort } from '@robota-sdk/agent-core';

/**
 * Map the framework's per-call reasoning-effort dial onto the OpenAI Responses API
 * `reasoning.effort` parameter.
 *
 * Per-model support and downward clamping are resolved by the Core table before this boundary.
 * This function only serializes the verified concrete value, without reinterpreting it.
 */
export function mapEffortToOpenAIReasoningEffort(
  effort: TModelEffort,
): IOpenAIResponsesReasoningOptions['effort'] {
  return effort;
}

/**
 * Merge the per-call effort dial into the provider's static reasoning options.
 *
 * A verified concrete resolution takes precedence over static native control; a conflicting static
 * control is rejected rather than silently overwritten. `auto` and `not-applied` resolutions leave
 * the provider default untouched and never manufacture a native effort field.
 */
export function resolveOpenAIReasoningOptions(
  staticReasoning: IOpenAIResponsesReasoningOptions | undefined,
  resolution: IModelEffortResolution | undefined,
): IOpenAIResponsesReasoningOptions | undefined {
  if (resolution === undefined) {
    return staticReasoning;
  }
  if (resolution.effective === null || resolution.disposition === 'model-default') {
    if (staticReasoning?.effort !== undefined) {
      throw new Error(
        `Static reasoning.effort ${staticReasoning.effort} conflicts with ${resolution.disposition === 'model-default' ? 'provider-default selection' : 'an effort resolution that does not apply a native control'}.`,
      );
    }
    return staticReasoning;
  }
  const effort = mapEffortToOpenAIReasoningEffort(resolution.effective);
  if (staticReasoning?.effort !== undefined && staticReasoning.effort !== effort) {
    throw new Error(
      `Resolved effort ${effort} conflicts with static reasoning.effort ${staticReasoning.effort}.`,
    );
  }
  return {
    ...staticReasoning,
    effort,
  };
}
