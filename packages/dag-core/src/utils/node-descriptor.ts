import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodType } from 'zod';

function isZodSchema(input: unknown): input is ZodType {
    if (typeof input !== 'object' || input === null) {
        return false;
    }
    return input instanceof z.ZodType;
}

export function buildConfigSchema(configSchemaDefinition: unknown): object {
    if (!isZodSchema(configSchemaDefinition)) {
        throw new Error('configSchemaDefinition must be a Zod schema instance.');
    }
    return zodToJsonSchema(configSchemaDefinition, {
        target: 'jsonSchema7'
    });
}
