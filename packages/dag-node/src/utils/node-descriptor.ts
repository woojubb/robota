import { z, type ZodType } from 'zod';
import type { TResult, IDagError } from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

function isZodSchema(input: unknown): input is ZodType {
  // `instanceof` is false for every primitive and for null, so it is the whole check.
  return input instanceof z.ZodType;
}

/**
 * Convert a zod schema to a JSON Schema representation for node config.
 * @param configSchemaDefinition - Zod schema instance, or null/undefined for nodes with no config
 * @returns JSON Schema object or validation error
 */
export function buildConfigSchema(
  configSchemaDefinition: unknown,
): TResult<Record<string, unknown>, IDagError> {
  // null/undefined means the node declares no config schema — accept any config
  if (configSchemaDefinition == null) {
    return { ok: true, value: {} };
  }
  if (!isZodSchema(configSchemaDefinition)) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_CONFIG_SCHEMA_INVALID',
        'configSchemaDefinition must be a Zod schema instance.',
      ),
    };
  }
  return {
    ok: true,
    value: z.toJSONSchema(configSchemaDefinition, { target: 'draft-07', io: 'input' }) as Record<
      string,
      unknown
    >,
  };
}
