import { validateAgainstJsonSchema } from '../schema/structured-output.js';

import type { IParameterSchema } from '../interfaces/provider';
import type { IParameterValidationResult, TToolParameters } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';

/**
 * Validate one parameter against its schema node. Returns the issues found; empty means valid.
 *
 * CORE-039: the LEAF checks and their messages live here because callers depend on them
 * (`Parameter "x" must be a string`). Everything with DEPTH — a nested object's own properties and
 * requirements, a union's branches — is delegated to `validateAgainstJsonSchema`, the single
 * complete walk over the subset. A second, shallower copy of that walk is what let a tool advertise
 * a nested contract that nothing on the input path checked.
 */
function validateParameterType(
  key: string,
  value: TUniversalValue,
  schema: IParameterSchema,
): string[] {
  // A union node carries `anyOf` instead of `type`, so it is answered before the type switch — and
  // by the deep walk, since deciding which branch matched is exactly what that walk does.
  if (schema.anyOf) {
    return delegateDeep(key, value, schema);
  }

  const expectedType = schema['type'];

  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return [`Parameter "${key}" must be a string, got ${typeof value}`];
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return [`Parameter "${key}" must be a number, got ${typeof value}`];
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return [`Parameter "${key}" must be a boolean, got ${typeof value}`];
      }
      break;

    case 'array': {
      if (!Array.isArray(value)) {
        return [`Parameter "${key}" must be an array, got ${typeof value}`];
      }
      // Check array items if specified
      if (schema.items) {
        const itemSchema = schema.items;
        for (let i = 0; i < value.length; i++) {
          const itemErrors = validateParameterType(`${key}[${i}]`, value[i], itemSchema);
          if (itemErrors.length > 0) {
            return itemErrors;
          }
        }
      }
      break;
    }

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        // Return here rather than falling through: the deep walk would report the same defect a
        // second time in its own dialect.
        return [`Parameter "${key}" must be an object, got ${typeof value}`];
      }
      return delegateDeep(key, value, schema);

    case 'integer':
    case 'null':
      // No leaf message of their own is depended on, so the deep walk owns them outright.
      return delegateDeep(key, value, schema);

    case undefined:
      return [`Parameter "${key}" declares neither a type nor anyOf`];

    default:
      return [`Parameter "${key}" has unsupported schema type "${String(expectedType)}"`];
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
      return [`Parameter "${key}" must be one of: ${enumValues.join(', ')}, got ${value}`];
    }
  }

  return [];
}

/**
 * Hand a parameter to the one complete walk. The path root is the caller-facing
 * `Parameter "<key>"` rather than a bare `$`, so a single `ValidationError` message does not mix two
 * dialects for the same argument.
 */
function delegateDeep(key: string, value: TUniversalValue, schema: IParameterSchema): string[] {
  return validateAgainstJsonSchema(schema, value, `Parameter "${key}"`);
}

/**
 * Collect all validation errors for the given parameters against a schema.
 */
export function getValidationErrors(
  parameters: TToolParameters,
  schemaRequired: string[],
  schemaProperties: Record<string, IParameterSchema>,
  additionalProperties?: boolean | IParameterSchema,
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
      if (additionalProperties === true) {
        continue;
      }
      if (additionalProperties && typeof additionalProperties === 'object') {
        errors.push(...validateParameterType(key, value, additionalProperties));
        continue;
      }
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }

    errors.push(...validateParameterType(key, value, paramSchema));
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
  additionalProperties?: boolean | IParameterSchema,
): IParameterValidationResult {
  const errors = getValidationErrors(
    parameters,
    schemaRequired,
    schemaProperties,
    additionalProperties,
  );
  return {
    isValid: errors.length === 0,
    errors,
  };
}
