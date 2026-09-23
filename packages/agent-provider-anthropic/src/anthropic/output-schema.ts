import { closeObjectSchemas } from '@robota-sdk/agent-core';

import type Anthropic from '@anthropic-ai/sdk';
import type {
  IChatOptions,
  IModelEffortResolution,
  TModelEffort,
  TUniversalValue,
} from '@robota-sdk/agent-core';

/**
 * Map a `json_schema` response format onto Anthropic's native structured-output
 * surface (`output_config.format`, CORE-015). Other formats have no Anthropic
 * equivalent and rely on the core-side validation loop.
 *
 * Anthropic rejects open-world objects, so every object node is closed on the way out. That
 * recursion is shared with the OpenAI strict seam (PROV-007) rather than kept private here — a walk
 * over this subset that misses a route leaves exactly the nodes it was written to fix untouched, and
 * a second copy has to be found and fixed separately. Anthropic asks only for closure; it does NOT
 * force every property into `required`, which is why no closure option is passed.
 */
export function buildOutputConfig(
  options: IChatOptions | undefined,
): Pick<Anthropic.MessageCreateParams, 'output_config'> | Record<string, never> {
  const effort = resolveAnthropicNativeEffort(options?.effortResolution);
  if (options?.responseFormat?.type !== 'json_schema' && effort === undefined) {
    return {};
  }
  return {
    output_config: {
      ...(effort !== undefined && { effort }),
      ...(options?.responseFormat?.type === 'json_schema' && {
        format: {
          type: 'json_schema' as const,
          schema: closeObjectSchemas(options.responseFormat.schema) as Record<
            string,
            TUniversalValue
          >,
        },
      }),
    },
  };
}

function resolveAnthropicNativeEffort(
  resolution: IModelEffortResolution | undefined,
): Anthropic.OutputConfig['effort'] | undefined {
  if (
    resolution === undefined ||
    resolution.effective === null ||
    resolution.disposition === 'model-default'
  ) {
    return undefined;
  }
  return toAnthropicNativeEffort(resolution.effective);
}

function toAnthropicNativeEffort(
  effort: TModelEffort,
): NonNullable<Anthropic.OutputConfig['effort']> {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort;
    case 'none':
    case 'minimal':
      throw new Error(`Anthropic does not support output_config.effort=${effort}.`);
  }
}
