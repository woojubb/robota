/**
 * Zod → JSON Schema conversion (SSOT).
 *
 * Owned by agent-core (CORE-015): the structured-output run pipeline and the
 * tools package both convert Zod schemas to the universal JSON-schema subset
 * (`IParameterSchema`), so the single converter lives at the bottom of the
 * dependency graph. The tools package imports these functions from core.
 *
 * CORE-039: the object shape walk is written ONCE and used by both the root and
 * every nested object. Two copies is how the two levels came to disagree — the
 * root named its fields while a nested object was emitted as a bare
 * `{ type: 'object' }`, so a model was told "this is an object" and nothing else.
 */

import type { IZodSchema, IZodSchemaDef, ISchemaConversionOptions } from './zod-schema-types';
import type {
  IObjectParameterSchema,
  IParameterSchema,
  TJSONSchemaEnum,
  TJSONSchemaKind,
} from '../interfaces/provider';
import type { TUniversalValue } from '../interfaces/types';

/**
 * Convert a Zod schema to the universal JSON-schema subset.
 *
 * The root must resolve to an object; `.refine()`/`.transform()`/`.optional()`/`.default()`
 * wrappers around one are unwrapped first. A root that is not an object throws rather than
 * silently returning an empty schema — an empty schema reaches the model as "an object, contents
 * unspecified", which is the failure this converter exists to prevent.
 */
export function zodToJsonSchema(
  schema: IZodSchema,
  options: ISchemaConversionOptions = {},
): IObjectParameterSchema {
  const schemaDef = requireDef(schema, 'Zod schema');
  const objectDef = unwrapToObjectDef(schemaDef);
  if (!objectDef) {
    throw new Error(
      `Zod schema root must be an object; got ${String(schemaDef.typeName)}. ` +
        'Wrap the fields in z.object({ … }) before converting.',
    );
  }
  return convertObjectShape(objectDef, options.allowAdditionalProperties);
}

/**
 * The one object walk: shape → `properties` + `required` + `additionalProperties`.
 * Used by the root and by every nested `ZodObject`.
 */
function convertObjectShape(
  objectDef: IZodSchemaDef,
  allowAdditionalProperties?: boolean,
): IObjectParameterSchema {
  const properties: Record<string, IParameterSchema> = {};
  const required: string[] = [];

  // Zod v3 exposes `shape` as a property; older/structural stand-ins expose it as a function.
  const shape = typeof objectDef.shape === 'function' ? objectDef.shape() : objectDef.shape;

  for (const [key, typeObj] of Object.entries(shape ?? {})) {
    properties[key] = convertZodTypeToProperty(typeObj);
    if (isRequiredField(typeObj)) {
      required.push(key);
    }
  }

  const additionalProperties = resolveAdditionalProperties(objectDef, allowAdditionalProperties);
  return {
    type: 'object',
    properties,
    required,
    ...(additionalProperties !== undefined && { additionalProperties }),
  };
}

/**
 * Map Zod's three unknown-key modes onto the subset, which previously saw only two.
 *
 * `strip` is Zod's DEFAULT and means "extra keys are accepted at the boundary, then dropped" — so it
 * is `true`, not omitted. Emitting omitted (which the subset reads as CLOSED) told every consumer to
 * reject payloads the author's own schema accepts. `strict` is the mode that actually rejects.
 */
function resolveAdditionalProperties(
  objectDef: IZodSchemaDef,
  allowAdditionalProperties?: boolean,
): boolean | undefined {
  if (allowAdditionalProperties) {
    return true;
  }
  switch (objectDef.unknownKeys) {
    case 'passthrough':
    case 'strip':
      return true;
    case 'strict':
      return false;
    default:
      // Not a Zod object with a declared mode — leave it to the subset's omitted-means-closed default.
      return undefined;
  }
}

/** Unwrap transparent wrappers until an object definition is reached; undefined if it never is. */
function unwrapToObjectDef(typeDef: IZodSchemaDef): IZodSchemaDef | undefined {
  const resolved = unwrapTransparent(typeDef);
  return resolved.typeName === 'ZodObject' ? resolved : undefined;
}

/**
 * Strip wrappers that do not change the emitted JSON schema: `ZodEffects` (`.refine()`,
 * `.transform()`), `ZodOptional`, `ZodNullable`, `ZodDefault`. Optionality is carried by
 * `isRequiredField`, not by the property's own shape.
 */
function unwrapTransparent(typeDef: IZodSchemaDef): IZodSchemaDef {
  let current = typeDef;
  // Bounded by the wrapper chain's own depth; each step strictly descends into an inner schema.
  for (;;) {
    const inner =
      current.typeName === 'ZodEffects'
        ? current.schema
        : current.typeName === 'ZodOptional' ||
            current.typeName === 'ZodNullable' ||
            current.typeName === 'ZodDefault'
          ? current.innerType
          : undefined;
    if (!inner) {
      return current;
    }
    current = requireDef(inner, `${String(current.typeName)} inner type`);
  }
}

function requireDef(schema: IZodSchema, label: string): IZodSchemaDef {
  const def = schema._def;
  if (!def) {
    throw new Error(`${label} is missing _def; cannot convert to JSON schema.`);
  }
  return def;
}

/**
 * Convert an individual Zod type to a subset node.
 */
function convertZodTypeToProperty(typeObj: IZodSchema): IParameterSchema {
  const typeDef = requireDef(typeObj, 'Zod type');

  const base: Partial<IParameterSchema> = {};
  if (typeDef.description) {
    base.description = typeDef.description;
  }

  switch (typeDef.typeName) {
    case 'ZodString':
      return { type: 'string', ...base };

    case 'ZodNumber':
      return { type: 'number', ...base };

    case 'ZodBoolean':
      return { type: 'boolean', ...base };

    case 'ZodArray': {
      if (!typeDef.type) {
        throw new Error('ZodArray is missing item type; cannot convert to JSON schema.');
      }
      return { type: 'array', items: convertZodTypeToProperty(typeDef.type), ...base };
    }

    case 'ZodObject':
      // The nested case delegates to the SAME walk the root uses, so the two cannot drift again.
      return { ...convertObjectShape(typeDef), ...base };

    case 'ZodEnum': {
      const enumValues = typeDef.values;
      if (!enumValues || !Array.isArray(enumValues)) {
        throw new Error('ZodEnum is missing enum values; cannot convert to JSON schema.');
      }
      return { type: 'string', enum: enumValues as TJSONSchemaEnum, ...base };
    }

    case 'ZodLiteral':
      return { ...convertLiteral(typeDef.value), ...base };

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const members = typeDef.options;
      if (!members || !Array.isArray(members) || members.length === 0) {
        throw new Error(
          `${String(typeDef.typeName)} is missing options; cannot convert to JSON schema.`,
        );
      }
      // A union node carries `anyOf` INSTEAD of `type` — emitting both is invalid JSON Schema.
      return { anyOf: members.map(convertZodTypeToProperty), ...base };
    }

    case 'ZodEffects': {
      if (!typeDef.schema) {
        throw new Error('ZodEffects is missing schema; cannot convert to JSON schema.');
      }
      return { ...convertZodTypeToProperty(typeDef.schema), ...base };
    }

    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault': {
      if (!typeDef.innerType) {
        throw new Error(
          `${String(typeDef.typeName)} is missing innerType; cannot convert to JSON schema.`,
        );
      }
      return { ...convertZodTypeToProperty(typeDef.innerType), ...base };
    }

    case 'ZodRecord':
      if (typeDef.valueType) {
        return {
          type: 'object',
          additionalProperties: convertZodTypeToProperty(typeDef.valueType),
          ...base,
        };
      }
      return { type: 'object', additionalProperties: { type: 'string' }, ...base };

    default:
      throw new Error(`Unsupported Zod type: ${String(typeDef.typeName)}`);
  }
}

/** A literal is a one-value enum of its own primitive type. */
function convertLiteral(value: TUniversalValue | undefined): IParameterSchema {
  const kind = literalKind(value);
  if (!kind) {
    throw new Error(
      `ZodLiteral value ${String(value)} is not a JSON primitive; cannot convert to JSON schema.`,
    );
  }
  return { type: kind, enum: [value] as TJSONSchemaEnum };
}

function literalKind(value: TUniversalValue | undefined): TJSONSchemaKind | undefined {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return undefined;
}

/**
 * Check if a Zod field is required (not optional, nullable, or defaulted), looking through
 * `ZodEffects` so `.optional().refine(…)` is not reported as required.
 */
function isRequiredField(typeObj: IZodSchema): boolean {
  const typeDef = typeObj._def;
  if (!typeDef) {
    throw new Error('Zod schema is missing _def; cannot determine required fields.');
  }

  const resolved =
    typeDef.typeName === 'ZodEffects' && typeDef.schema
      ? requireDef(typeDef.schema, 'ZodEffects inner type')
      : typeDef;

  return (
    resolved.typeName !== 'ZodOptional' &&
    resolved.typeName !== 'ZodNullable' &&
    resolved.typeName !== 'ZodDefault'
  );
}

/**
 * Safely extract enum values from Zod schema
 */
export function extractEnumValues(schema: IZodSchema): TUniversalValue[] {
  const typeDef = requireDef(schema, 'Zod schema');
  if (!typeDef.values || !Array.isArray(typeDef.values)) {
    throw new Error('ZodEnum schema is missing enum values; cannot extract enum values.');
  }
  return typeDef.values;
}

/**
 * Check if schema has validation constraints
 */
export function hasValidationConstraints(schema: IZodSchema): boolean {
  const typeDef = requireDef(schema, 'Zod schema');
  return !!(typeDef.checks && typeDef.checks.length > 0);
}

/**
 * Safe schema type name extraction
 */
export function getSchemaTypeName(schema: IZodSchema): string {
  const typeDef = requireDef(schema, 'Zod schema');
  if (!typeDef.typeName) {
    throw new Error('Zod schema has empty typeName; cannot determine schema type name.');
  }
  return typeDef.typeName;
}
