import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodType } from 'zod';
import type { TResult } from '@robota-sdk/dag-core';
import type { IDagError } from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

function isZodSchema(input: unknown): input is ZodType {
    if (typeof input !== 'object' || input === null) {
        return false;
    }
    return input instanceof z.ZodType;
}

/**
 * Convert a zod schema to a JSON Schema representation for node config.
 * @param configSchemaDefinition - Must be a zod schema instance
 * @returns JSON Schema object or validation error
 */
export function buildConfigSchema(configSchemaDefinition: unknown): TResult<Record<string, unknown>, IDagError> {
    if (!isZodSchema(configSchemaDefinition)) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_CONFIG_SCHEMA_INVALID',
                'configSchemaDefinition must be a Zod schema instance.'
            )
        };
    }
    return {
        ok: true,
        value: zodToJsonSchema(configSchemaDefinition, {
            target: 'jsonSchema7'
        }) as Record<string, unknown>
    };
}
