/**
 * Reading a Zod schema's `_def` — the inspection half of the converter (CORE-039).
 *
 * Split from `zod-to-json-schema.ts` by responsibility: everything here ANSWERS QUESTIONS about a
 * Zod schema (what does it wrap, is this field required, what unknown-key mode is it in), while the
 * sibling module decides what subset node to emit. The dependency runs one way, conversion →
 * inspection, so the mutual recursion between the object walk and the node walk stays in one file.
 */

import type { IZodSchema, IZodSchemaDef } from './zod-schema-types';
import type { TJSONSchemaKind } from '../interfaces/provider';
import type { TUniversalValue } from '../interfaces/types';

/** Guard for the structural stand-in: real Zod wrapper chains are nowhere near this deep. */
export const MAX_WRAPPER_DEPTH = 64;

/**
 * Map Zod's three unknown-key modes onto the subset, which previously saw only two.
 *
 * `strip` is Zod's DEFAULT and means "extra keys are accepted at the boundary, then dropped" — so it
 * is `true`, not omitted. Emitting omitted (which the subset reads as CLOSED) told every consumer to
 * reject payloads the author's own schema accepts. `strict` is the mode that actually rejects.
 */
export function resolveAdditionalProperties(
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
export function unwrapToObjectDef(typeDef: IZodSchemaDef): IZodSchemaDef | undefined {
  const resolved = unwrapTransparent(typeDef);
  return resolved.typeName === 'ZodObject' ? resolved : undefined;
}

/**
 * Strip wrappers that do not change the emitted JSON schema: `ZodEffects` (`.refine()`,
 * `.transform()`), `ZodOptional`, `ZodNullable`, `ZodDefault`. Optionality is carried by
 * `isRequiredField`, not by the property's own shape.
 */
export function unwrapTransparent(typeDef: IZodSchemaDef): IZodSchemaDef {
  let current = typeDef;
  // Real Zod builds wrapper chains acyclically, but `IZodSchema` is a structural stand-in and
  // `zodToJsonSchema` is exported — so this loop is reachable with a hand-built `_def` whose
  // `innerType` points at itself. The cap turns that into the file's usual loud failure instead of
  // a hang.
  for (let depth = 0; depth <= MAX_WRAPPER_DEPTH; depth += 1) {
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
  throw new Error(
    `Zod wrapper chain exceeds ${MAX_WRAPPER_DEPTH} levels; refusing to unwrap further (cyclic schema?).`,
  );
}

export function requireDef(schema: IZodSchema, label: string): IZodSchemaDef {
  const def = schema._def;
  if (!def) {
    throw new Error(`${label} is missing _def; cannot convert to JSON schema.`);
  }
  return def;
}

export function literalKind(value: TUniversalValue | undefined): TJSONSchemaKind | undefined {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'null';
  return undefined;
}

/**
 * Check if a Zod field is required (not optional, nullable, or defaulted), looking through
 * `ZodEffects` so `.optional().refine(…)` is not reported as required.
 */
export function isRequiredField(typeObj: IZodSchema): boolean {
  const typeDef = typeObj._def;
  if (!typeDef) {
    throw new Error('Zod schema is missing _def; cannot determine required fields.');
  }

  // Loop, do not peel one level: `.optional().refine(f).refine(f)` is two ZodEffects deep, and a
  // single unwrap reported that field as required -- the model then being told an optional field is
  // mandatory. A partial copy of the unwrap is the same divergence this file exists to remove.
  let resolved = typeDef;
  for (
    let depth = 0;
    resolved.typeName === 'ZodEffects' && depth <= MAX_WRAPPER_DEPTH;
    depth += 1
  ) {
    if (!resolved.schema) break;
    resolved = requireDef(resolved.schema, 'ZodEffects inner type');
  }

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
