import { closeObjectSchemas } from '@robota-sdk/agent-core';

import type Anthropic from '@anthropic-ai/sdk';
import type { IChatOptions } from '@robota-sdk/agent-core';

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
  if (options?.responseFormat?.type !== 'json_schema') {
    return {};
  }
  return {
    output_config: {
      format: {
        type: 'json_schema',
        schema: closeObjectSchemas(options.responseFormat.schema) as Record<string, unknown>,
      },
    },
  };
}
