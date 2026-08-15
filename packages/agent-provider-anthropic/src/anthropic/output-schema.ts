import type { IChatOptions } from '@robota-sdk/agent-core';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Map a `json_schema` response format onto Anthropic's native structured-output
 * surface (`output_config.format`, CORE-015). Other formats have no Anthropic
 * equivalent and rely on the core-side validation loop.
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

/**
 * Anthropic's structured-output surface rejects open-world objects: every
 * `object` node must carry an explicit `additionalProperties: false`. The
 * universal schema subset leaves it unset (closed by convention), so close
 * every object node recursively at this SDK seam. The consumer's original
 * schema still governs core-side validation.
 */
function closeObjectSchemas(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(closeObjectSchemas);
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  const record = node as Record<string, unknown>;
  const closed: Record<string, unknown> = { ...record };
  if (record.properties && typeof record.properties === 'object') {
    closed.properties = Object.fromEntries(
      Object.entries(record.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        closeObjectSchemas(value),
      ]),
    );
  }
  if (record.items && typeof record.items === 'object') {
    closed.items = closeObjectSchemas(record.items);
  }
  // CORE-039: a union node's branches are objects too. Without this the spread carries `anyOf`
  // through unrecursed, leaving every object inside a branch open — the exact thing this seam
  // exists to prevent, reached by the one route it did not walk.
  if (Array.isArray(record.anyOf)) {
    closed.anyOf = record.anyOf.map(closeObjectSchemas);
  }
  if (record.additionalProperties && typeof record.additionalProperties === 'object') {
    // Schema-valued additionalProperties (record types) pass through recursed;
    // Anthropic may reject them — surfaced as a provider error, not masked here.
    closed.additionalProperties = closeObjectSchemas(record.additionalProperties);
  } else if (record.type === 'object') {
    // Deliberate overwrite, including of an explicit `true`. CORE-039 made the converter emit
    // `additionalProperties: true` routinely (Zod's default `strip` means "accept then drop"), and
    // Anthropic still requires every object node closed at this seam. The consumer's original
    // schema keeps governing core-side validation, where the `true` is honoured.
    closed.additionalProperties = false;
  }
  return closed;
}
