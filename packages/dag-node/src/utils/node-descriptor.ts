import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodType } from 'zod';
import type { TResult, IDagError } from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

function isZodSchema(input: unknown): input is ZodType {
  if (typeof input !== 'object' || input === null) {
    return false;
  }
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
  // Reference `zodToJsonSchema` through a simplified signature so its return-type
  // generic does not instantiate excessively deep over the schema type (TS2589).
  const toJsonSchema = zodToJsonSchema as unknown as (
    schema: ZodType,
    opts?: { target?: string },
  ) => Record<string, unknown>;
  return {
    ok: true,
    value: toJsonSchema(configSchemaDefinition, { target: 'jsonSchema7' }),
  };
}
