import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodType } from 'zod';
import type { TResult } from '../types/result.js';
import type { IDagError } from '../types/error.js';
import { buildValidationError } from './error-builders.js';

function isZodSchema(input: unknown): input is ZodType {
    if (typeof input !== 'object' || input === null) {
        return false;
    }
    return input instanceof z.ZodType;
}

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
