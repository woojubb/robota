import type {
  IParameterSchema,
  TToolParameters,
  IParameterValidationResult,
} from '@robota-sdk/agent-core';
import type { TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Validate individual parameter type against its schema.
 * Returns an error string if invalid, undefined if valid.
 */
export function validateParameterType(
  key: string,
  value: TUniversalValue,
  schema: IParameterSchema,
): string | undefined {
  const expectedType = schema['type'];

  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return `Parameter "${key}" must be a string, got ${typeof value}`;
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return `Parameter "${key}" must be a number, got ${typeof value}`;
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Parameter "${key}" must be a boolean, got ${typeof value}`;
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return `Parameter "${key}" must be an array, got ${typeof value}`;
      }
      // Check array items if specified
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemError = validateParameterType(`${key}[${i}]`, value[i], schema.items);
          if (itemError) {
            return itemError;
          }
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `Parameter "${key}" must be an object, got ${typeof value}`;
      }
      break;
  }

  // Check enum constraints
  if (schema.enum && schema.enum.length > 0) {
    const enumValues = schema.enum;
    let isValidEnum = false;

    // Type-safe enum checking based on JSONSchemaEnum type
    for (const enumValue of enumValues) {
      if (value === enumValue) {
        isValidEnum = true;
        break;
      }
    }

    if (!isValidEnum) {
      return `Parameter "${key}" must be one of: ${enumValues.join(', ')}, got ${value}`;
    }
  }

  return undefined;
}

/**
 * Collect all validation errors for the given parameters against a schema.
 */
export function getValidationErrors(
  parameters: TToolParameters,
  schemaRequired: string[],
  schemaProperties: Record<string, IParameterSchema>,
): string[] {
  const errors: string[] = [];

  // Check required parameters
  for (const field of schemaRequired) {
    if (!(field in parameters)) {
      errors.push(`Missing required parameter: ${field}`);
    }
  }

  // Check parameter types and constraints
  for (const [key, value] of Object.entries(parameters)) {
    const paramSchema = schemaProperties[key];
    if (!paramSchema) {
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }

    const typeError = validateParameterType(key, value, paramSchema);
    if (typeError) {
      errors.push(typeError);
    }
  }

  return errors;
}

/**
 * Validate parameters and return a structured result.
 */
export function validateToolParameters(
  parameters: TToolParameters,
  schemaRequired: string[],
  schemaProperties: Record<string, IParameterSchema>,
): IParameterValidationResult {
  const errors = getValidationErrors(parameters, schemaRequired, schemaProperties);
  return {
    isValid: errors.length === 0,
    errors,
  };
}
