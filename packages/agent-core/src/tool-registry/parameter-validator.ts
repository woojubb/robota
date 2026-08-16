import { validateAgainstJsonSchema } from '../schema/structured-output.js';

import type { IParameterSchema } from '../interfaces/provider';
import type { IParameterValidationResult, TToolParameters } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';

/**
 * Validate one parameter against its schema node. Returns the issues found; empty means valid.
 *
 * CORE-039: exactly ONE thing lives here — the leaf TYPE mismatch and its caller-facing wording
 * (`Parameter "x" must be a string`), which callers depend on. Everything else — enum, numeric
 * bounds, pattern, a nested object's own properties and requirements, a union's branches — is
 * `validateAgainstJsonSchema`'s, the single complete walk over the subset.
 *
 * The split is by CONCERN, not by kind. Delegating only some kinds is what made constraint
 * enforcement depend on where a node sat: a `minimum` was checked inside a nested object and
 * ignored at the top level, and two message dialects appeared at the same position depending on the
 * declared type. That is the divergence this item exists to remove, so the boundary is drawn once
 * and applies to every node.
 */
function validateParameterType(
  key: string,
  value: TUniversalValue,
  schema: IParameterSchema,
): string[] {
  const mismatch = leafTypeMismatch(key, value, schema);
  if (mismatch) {
    // Return rather than fall through: the deep walk would otherwise report the same defect a
    // second time in its own dialect, inside one ValidationError message.
    return [mismatch];
  }
  return validateAgainstJsonSchema(schema, value, `Parameter "${key}"`);
}

/**
 * The caller-facing type check. `undefined` means "no leaf mismatch to report" — either the value
 * matches the declared kind, or the node is one the deep walk answers on its own (a union, or a
 * kind with no caller-facing wording of its own).
 */
function leafTypeMismatch(
  key: string,
  value: TUniversalValue,
  schema: IParameterSchema,
): string | undefined {
  if (schema.anyOf) {
    // A union node carries `anyOf` instead of `type`; deciding which branch matched is precisely
    // what the deep walk does, and no single leaf message can describe the failure.
    return undefined;
  }

  const expectedType = schema['type'];
  switch (expectedType) {
    case 'string':
      return typeof value === 'string'
        ? undefined
        : `Parameter "${key}" must be a string, got ${describeValue(value)}`;

    case 'number':
    case 'integer':
      return typeof value === 'number' && !isNaN(value)
        ? undefined
        : `Parameter "${key}" must be a number, got ${describeValue(value)}`;

    case 'boolean':
      return typeof value === 'boolean'
        ? undefined
        : `Parameter "${key}" must be a boolean, got ${describeValue(value)}`;

    case 'array':
      return Array.isArray(value)
        ? undefined
        : `Parameter "${key}" must be an array, got ${describeValue(value)}`;

    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? undefined
        : `Parameter "${key}" must be an object, got ${describeValue(value)}`;

    case 'null':
      // No caller-facing wording of its own; the deep walk reports it.
      return undefined;

    case undefined:
      // Reachable since `type` became optional for union nodes. A node with neither is not a valid
      // subset node, and accepting it silently is the failure class this item removes.
      return `Parameter "${key}" declares neither a type nor anyOf`;

    default:
      return `Parameter "${key}" has unsupported schema type "${String(expectedType)}"`;
  }
}

/** `typeof null` is `'object'`, which makes the leaf message actively misleading for a null. */
function describeValue(value: TUniversalValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
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
