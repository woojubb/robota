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

import {
  isRequiredField,
  normalizeEnumValues,
  normalizedTypeName,
  requireDef,
  literalKind,
  resolveAdditionalProperties,
  unwrapToObjectDef,
} from './zod-schema-inspect';

import type { IZodSchema, IZodSchemaDef, ISchemaConversionOptions } from './zod-schema-types';
import type {
  IObjectParameterSchema,
  IParameterSchema,
  TJSONSchemaEnum,
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
      `Zod schema root must be an object; got ${String(normalizedTypeName(schemaDef))}. ` +
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

  // Zod v3's `_def.shape` is a FUNCTION (the property form is the `ZodObject.shape` getter);
  // structural stand-ins supply it directly. Accept both.
  const shape = typeof objectDef.shape === 'function' ? objectDef.shape() : objectDef.shape;

  for (const [key, typeObj] of Object.entries(shape ?? {})) {
    properties[key] = convertZodTypeToProperty(typeObj, allowAdditionalProperties);
    if (isRequiredField(typeObj)) {
      required.push(key);
    }
  }

  const resolvedAdditionalProperties = resolveAdditionalProperties(
    objectDef,
    allowAdditionalProperties,
  );
  const additionalProperties =
    typeof resolvedAdditionalProperties === 'object'
      ? convertZodTypeToProperty(resolvedAdditionalProperties, allowAdditionalProperties)
      : resolvedAdditionalProperties;
  return {
    type: 'object',
    properties,
    required,
    ...(additionalProperties !== undefined && { additionalProperties }),
  };
}

/**
 * Convert an individual Zod type to a subset node.
 */
function convertZodTypeToProperty(
  typeObj: IZodSchema,
  allowAdditionalProperties?: boolean,
): IParameterSchema {
  const typeDef = requireDef(typeObj, 'Zod type');
  const typeName = normalizedTypeName(typeDef);

  const base: Partial<IParameterSchema> = {};
  if (typeDef.description ?? typeObj.description) {
    base.description = typeDef.description ?? typeObj.description;
  }

  switch (typeName) {
    case 'ZodString':
      return { type: 'string', ...base };

    case 'ZodNumber':
      return { type: 'number', ...base };

    case 'ZodBoolean':
      return { type: 'boolean', ...base };

    case 'ZodArray': {
      const item = typeDef.element ?? (typeof typeDef.type === 'object' ? typeDef.type : undefined);
      if (!item) {
        throw new Error('ZodArray is missing item type; cannot convert to JSON schema.');
      }
      return {
        type: 'array',
        items: convertZodTypeToProperty(item, allowAdditionalProperties),
        ...base,
      };
    }

    case 'ZodObject':
      // The nested case delegates to the SAME walk the root uses, so the two cannot drift again.
      return { ...convertObjectShape(typeDef, allowAdditionalProperties), ...base };

    case 'ZodEnum': {
      const enumValues = typeDef.values ?? typeDef.entries;
      if (!enumValues) {
        throw new Error('ZodEnum is missing enum values; cannot convert to JSON schema.');
      }
      return { ...convertNativeEnum(enumValues), ...base };
    }

    case 'ZodNativeEnum': {
      // CORE-041: `_def.values` is the enum OBJECT here, not the array `ZodEnum` carries.
      return { ...convertNativeEnum(typeDef.values), ...base };
    }

    case 'ZodDate':
      // CORE-041: JSON has no date type, so a string is what the provider receives either way —
      // this is the faithful description of the payload, not a lossy stand-in. `format` carries the
      // intent to a provider that reads it, and `validateAgainstJsonSchema` checks the type.
      return { type: 'string', format: 'date-time', ...base };

    case 'ZodLiteral':
      return {
        ...convertLiteralValues(Array.isArray(typeDef.values) ? typeDef.values : [typeDef.value]),
        ...base,
      };

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const members = typeDef.options;
      if (!members || !Array.isArray(members) || members.length === 0) {
        throw new Error(`${String(typeName)} is missing options; cannot convert to JSON schema.`);
      }
      // A union node carries `anyOf` INSTEAD of `type` — emitting both is invalid JSON Schema.
      return {
        anyOf: members.map((member) => convertZodTypeToProperty(member, allowAdditionalProperties)),
        ...base,
      };
    }

    case 'ZodEffects': {
      if (!typeDef.schema) {
        throw new Error('ZodEffects is missing schema; cannot convert to JSON schema.');
      }
      return { ...convertZodTypeToProperty(typeDef.schema, allowAdditionalProperties), ...base };
    }

    case 'ZodPipe': {
      if (!typeDef.in) {
        throw new Error('ZodPipe is missing input schema; cannot convert to JSON schema.');
      }
      return { ...convertZodTypeToProperty(typeDef.in, allowAdditionalProperties), ...base };
    }

    case 'ZodNullable': {
      if (!typeDef.innerType) {
        throw new Error('ZodNullable is missing innerType; cannot convert to JSON schema.');
      }
      // The null branch is part of what the field accepts, so it has to survive into the schema.
      // Dropping it was harmless only while nested nodes were opaque; now that depth is enforced,
      // an advertised `{type:'string'}` would reject a `null` the author's own Zod schema accepts.
      return {
        anyOf: [
          convertZodTypeToProperty(typeDef.innerType, allowAdditionalProperties),
          { type: 'null' },
        ],
        ...base,
      };
    }

    case 'ZodOptional':
    case 'ZodDefault': {
      if (!typeDef.innerType) {
        throw new Error(`${String(typeName)} is missing innerType; cannot convert to JSON schema.`);
      }
      return { ...convertZodTypeToProperty(typeDef.innerType, allowAdditionalProperties), ...base };
    }

    case 'ZodRecord':
      if (typeDef.valueType) {
        return {
          type: 'object',
          additionalProperties: convertZodTypeToProperty(
            typeDef.valueType,
            allowAdditionalProperties,
          ),
          ...base,
        };
      }
      return { type: 'object', additionalProperties: { type: 'string' }, ...base };

    default:
      throw new Error(unsupportedConstructMessage(String(typeName)));
  }
}

function convertLiteralValues(values: Array<TUniversalValue | undefined>): IParameterSchema {
  if (values.length === 0) {
    throw new Error('ZodLiteral declares no values; cannot convert to JSON schema.');
  }
  const kinds = new Set(values.map(literalKind));
  if (kinds.size !== 1) {
    return { anyOf: values.map((value) => convertLiteral(value)) };
  }
  const kind = literalKind(values[0]);
  if (!kind) return convertLiteral(values[0]);
  return kind === 'null' ? { type: 'null' } : { type: kind, enum: values as TJSONSchemaEnum };
}

/** A literal is a one-value enum of its own primitive type. */
function convertLiteral(value: TUniversalValue | undefined): IParameterSchema {
  const kind = literalKind(value);
  if (!kind) {
    throw new Error(
      `ZodLiteral value ${String(value)} is not a JSON primitive; cannot convert to JSON schema.`,
    );
  }
  // `TJSONSchemaEnum` has no null member, and a null literal needs none: `type: 'null'` already
  // admits exactly one value.
  return kind === 'null' ? { type: 'null' } : { type: kind, enum: [value] as TJSONSchemaEnum };
}

/**
 * Convert a `ZodNativeEnum`'s value set — CORE-041.
 *
 * A NUMERIC TypeScript enum compiles to an object with a reverse mapping, so `Object.values` on
 * `enum Level { Low, High }` yields `['Low', 'High', 0, 1]`. Emitting that would advertise `"Low"` as
 * an acceptable value for a field that accepts `0`, which is a wrong contract rather than a wide one.
 * When any numeric value is present, the numeric half IS the value set and the names are the
 * compiler's bookkeeping.
 */
function convertNativeEnum(values: IZodSchemaDef['values']): IParameterSchema {
  if (!values || typeof values !== 'object') {
    throw new Error('ZodNativeEnum is missing enum values; cannot convert to JSON schema.');
  }
  const members = normalizeEnumValues(values);
  if (members.length === 0) {
    throw new Error('ZodNativeEnum declares no members; cannot convert to JSON schema.');
  }
  const numeric = members.filter((entry): entry is number => typeof entry === 'number');
  const strings = members.filter((entry): entry is string => typeof entry === 'string');
  if (numeric.length > 0 && strings.length > 0) {
    return {
      anyOf: [
        { type: 'string', enum: strings },
        { type: 'number', enum: numeric },
      ],
    };
  }
  return {
    type: numeric.length > 0 ? 'number' : 'string',
    enum: members as TJSONSchemaEnum,
  };
}

/**
 * The boundary between Zod and the universal JSON-schema subset, stated where a consumer hits it —
 * CORE-041.
 *
 * The old message was `Unsupported Zod type: ZodTuple`: the name of the consumer's own construct,
 * and nothing they could act on. The boundary is real and staying — these constructs need
 * positional `items`, `allOf` or `$ref`, none of which the subset carries, and none of which the
 * field-enumerated provider mappers would forward if it did. That is also why adopting
 * `zod-to-json-schema` does not dissolve this: the difficulty was never PARSING Zod, it is that the
 * target language cannot say these things, and a library emitting a richer document widens the gap.
 *
 * Mapping them lossily was the other option and is worse than throwing: a tuple flattened to an
 * array of `anyOf` members would tell the model that any order and any length are acceptable — a
 * contract the author did not write. A loud boundary a consumer can route around beats a quiet one
 * that misdescribes their schema.
 */
const CONSTRUCT_GUIDANCE: Record<string, string> = {
  ZodTuple:
    'a tuple needs positional `items`, and the subset models `items` as ONE schema — use `z.object({...})` for a fixed-shape record, or `z.array(z.union([...]))` if order genuinely does not matter',
  ZodIntersection:
    'an intersection needs `allOf` — merge the two object schemas yourself with `.merge()`, which produces a single object node the subset can carry',
  ZodLazy:
    'a recursive schema needs `$ref` — flatten the recursion to a fixed depth, or model the nested level as `z.record(...)`',
  ZodDate: 'use `z.string()` (optionally with `.datetime()`), which is what a provider receives',
};

function unsupportedConstructMessage(typeName: string): string {
  const guidance = CONSTRUCT_GUIDANCE[typeName];
  const why = guidance ?? 'it has no representation in the subset';
  return (
    `${typeName} cannot be carried by the universal JSON-schema subset: ${why}. ` +
    'The subset is the one language every provider mapper forwards intact; a construct outside it ' +
    'would be advertised to the model and enforced by nothing.'
  );
}
