/**
 * Structured output normalization and validation (CORE-015).
 *
 * `run(input, { output })` accepts either a Zod schema or an explicit JSON-schema
 * wrapper. Both normalize to one internal representation (`IStructuredOutputSpec`)
 * that carries the JSON schema for the provider's native structured-output surface
 * and a validate function for the core-side enforcement loop. The enforcement loop
 * is the universal contract: providers with a native surface enforce early, and for
 * providers without one the bounded validate-and-retry loop still guarantees the
 * returned object matches the schema.
 */

import { zodToJsonSchema } from './zod-to-json-schema';

import type { IZodSchema } from './zod-schema-types';
import type { IToolSchema, IParameterSchema } from '../interfaces/provider';

/** Explicit raw-JSON-schema form of `IRunOptions.output`. */
export interface IJsonSchemaOutput {
  /** JSON Schema (object root, universal subset) the response must match. */
  jsonSchema: IToolSchema['parameters'];
  /** Optional schema name forwarded to provider native surfaces. */
  name?: string;
}

/** Accepted `IRunOptions.output` values: a Zod schema or an explicit JSON-schema wrapper. */
export type TStructuredOutputSchema = IZodSchema | IJsonSchemaOutput;

export type TStructuredOutputValidation =
  | { success: true; value: unknown }
  | { success: false; issues: string[] };

/** Internal SSOT representation every `output` value normalizes to. */
export interface IStructuredOutputSpec {
  name: string;
  jsonSchema: IToolSchema['parameters'];
  validate(value: unknown): TStructuredOutputValidation;
}

function isZodSchema(output: TStructuredOutputSchema): output is IZodSchema {
  return (
    typeof (output as IZodSchema).safeParse === 'function' &&
    typeof (output as IZodSchema).parse === 'function'
  );
}

function formatZodError(error: unknown): string[] {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues.map((issue) => {
        if (issue && typeof issue === 'object' && 'message' in issue) {
          const path = Array.isArray((issue as { path?: unknown[] }).path)
            ? (issue as { path: unknown[] }).path.join('.')
            : '';
          const message = String((issue as { message: unknown }).message);
          return path ? `${path}: ${message}` : message;
        }
        return String(issue);
      });
    }
  }
  return [String(error)];
}

/** Normalize an accepted `output` value into the internal spec. */
export function normalizeStructuredOutput(output: TStructuredOutputSchema): IStructuredOutputSpec {
  if (isZodSchema(output)) {
    return {
      name: 'structured_output',
      jsonSchema: zodToJsonSchema(output),
      validate: (value) => {
        const result = output.safeParse(value);
        if (result.success) {
          return { success: true, value: result.data };
        }
        return { success: false, issues: formatZodError(result.error) };
      },
    };
  }
  const { jsonSchema, name } = output;
  return {
    name: name ?? 'structured_output',
    jsonSchema,
    validate: (value) => {
      const issues = validateAgainstJsonSchema(jsonSchema, value, '$');
      return issues.length === 0 ? { success: true, value } : { success: false, issues };
    },
  };
}

/**
 * Validate a value against the universal JSON-schema subset used by tool
 * parameters (`IParameterSchema`). Covers type, required, enum, items, nested
 * properties, and numeric bounds — the full expressible surface of the subset.
 */
export function validateAgainstJsonSchema(
  schema: IToolSchema['parameters'] | IParameterSchema,
  value: unknown,
  path: string,
): string[] {
  const issues: string[] = [];
  const kind = schema.type;

  switch (kind) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [`${path}: expected object, got ${describeType(value)}`];
      }
      const record = value as Record<string, unknown>;
      const required = 'required' in schema ? (schema.required ?? []) : [];
      for (const key of required) {
        if (!(key in record)) {
          issues.push(`${path}.${key}: required property missing`);
        }
      }
      const properties = schema.properties ?? {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in record) {
          issues.push(...validateAgainstJsonSchema(propertySchema, record[key], `${path}.${key}`));
        }
      }
      const additional = schema.additionalProperties;
      if (additional === undefined || additional === false) {
        for (const key of Object.keys(record)) {
          if (!(key in properties)) {
            issues.push(`${path}.${key}: unexpected additional property`);
          }
        }
      } else if (typeof additional === 'object') {
        for (const [key, entry] of Object.entries(record)) {
          if (!(key in properties)) {
            issues.push(...validateAgainstJsonSchema(additional, entry, `${path}.${key}`));
          }
        }
      }
      return issues;
    }

    case 'array': {
      if (!Array.isArray(value)) {
        return [`${path}: expected array, got ${describeType(value)}`];
      }
      const items = 'items' in schema ? schema.items : undefined;
      if (items) {
        value.forEach((entry, index) => {
          issues.push(...validateAgainstJsonSchema(items, entry, `${path}[${index}]`));
        });
      }
      return issues;
    }

    case 'string': {
      if (typeof value !== 'string') {
        return [`${path}: expected string, got ${describeType(value)}`];
      }
      if ('enum' in schema && schema.enum && !schema.enum.some((entry) => entry === value)) {
        issues.push(
          `${path}: value ${JSON.stringify(value)} is not one of the allowed enum values`,
        );
      }
      if ('pattern' in schema && schema.pattern && !new RegExp(schema.pattern).test(value)) {
        issues.push(`${path}: value does not match pattern ${schema.pattern}`);
      }
      return issues;
    }

    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return [`${path}: expected number, got ${describeType(value)}`];
      }
      if (kind === 'integer' && !Number.isInteger(value)) {
        issues.push(`${path}: expected integer, got non-integer number`);
      }
      if ('minimum' in schema && schema.minimum !== undefined && value < schema.minimum) {
        issues.push(`${path}: value ${value} is below minimum ${schema.minimum}`);
      }
      if ('maximum' in schema && schema.maximum !== undefined && value > schema.maximum) {
        issues.push(`${path}: value ${value} is above maximum ${schema.maximum}`);
      }
      if ('enum' in schema && schema.enum && !schema.enum.some((entry) => entry === value)) {
        issues.push(`${path}: value ${value} is not one of the allowed enum values`);
      }
      return issues;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        return [`${path}: expected boolean, got ${describeType(value)}`];
      }
      return issues;
    }

    case 'null': {
      if (value !== null) {
        return [`${path}: expected null, got ${describeType(value)}`];
      }
      return issues;
    }

    default:
      return [`${path}: unsupported schema type ${String(kind)}`];
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Parse the model's final text into a JSON value. Tolerates a fenced
 * ```json code block wrapper (providers without native enforcement commonly
 * emit one); the parsed value is still strictly schema-validated afterwards.
 */
export function parseStructuredResponseText(
  text: string,
): { success: true; value: unknown } | { success: false; issue: string } {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return { success: true, value: JSON.parse(candidate) };
  } catch (error) {
    // allow-fallback: converts JSON.parse failure into a typed failure result feeding the bounded retry loop
    return {
      success: false,
      issue: `response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
