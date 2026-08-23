/**
 * TRANS-005 (#2081) — decoders for the tool schemas a session record persists.
 *
 * `IParameterSchema` is the universal JSON-schema subset, and it is recursive: `items`, `properties`
 * and `anyOf` all carry the same node type. `properties` is an OPEN map — its keys are the tool
 * author's parameter names, not contract members — while every node's own member set is declared.
 */

import { addIssue, atKey, describeValue, setOptional } from './decode-outcome.js';
import {
  decodeArray,
  decodeDeclaredObject,
  decodeLiteral,
  decodeNumber,
  decodeOpenMap,
  decodeOptional,
  decodeString,
  decodeStringArray,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type {
  IObjectParameterSchema,
  IParameterSchema,
  IToolSchema,
  TJSONSchemaEnum,
  TJSONSchemaKind,
  TParameterDefaultValue,
} from '@robota-sdk/agent-core';

const SCHEMA_KINDS = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
] as const satisfies readonly TJSONSchemaKind[];

const PARAMETER_SCHEMA_KEYS = [
  'type',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'anyOf',
  'additionalProperties',
  'minimum',
  'maximum',
  'pattern',
  'format',
  'default',
];

function decodeEnumMember(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  addIssue(issues, path, `expected a string, number or boolean, received ${describeValue(value)}`);
  return undefined;
}

function decodeDefaultValue(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): TParameterDefaultValue | undefined {
  if (value === null) return null;
  return decodeEnumMember(value, path, issues);
}

/**
 * `additionalProperties` is either a closure flag or a schema for the properties not named — the
 * two are told apart by JavaScript type, which is how JSON Schema itself spells it.
 */
function decodeAdditionalProperties(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): boolean | IParameterSchema | undefined {
  if (typeof value === 'boolean') return value;
  return decodeParameterSchema(value, path, issues);
}

function decodeParameterSchema(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IParameterSchema | undefined {
  const raw = decodeDeclaredObject(value, path, issues, PARAMETER_SCHEMA_KEYS);
  if (raw === undefined) return undefined;

  const schema: IParameterSchema = {};
  setOptional(
    schema,
    'type',
    decodeOptional(raw['type'], atKey(path, 'type'), issues, (member, memberPath, sink) =>
      decodeLiteral(member, SCHEMA_KINDS, memberPath, sink),
    ),
  );
  setOptional(
    schema,
    'description',
    decodeOptional(raw['description'], atKey(path, 'description'), issues, decodeString),
  );
  setOptional(
    schema,
    'enum',
    decodeOptional(raw['enum'], atKey(path, 'enum'), issues, (member, memberPath, sink) => {
      const decoded = decodeArray(member, memberPath, sink, decodeEnumMember);
      return decoded as TJSONSchemaEnum | undefined;
    }),
  );
  setOptional(
    schema,
    'items',
    decodeOptional(raw['items'], atKey(path, 'items'), issues, decodeParameterSchema),
  );
  setOptional(
    schema,
    'properties',
    decodeOptional(
      raw['properties'],
      atKey(path, 'properties'),
      issues,
      (member, memberPath, sink) => decodeOpenMap(member, memberPath, sink, decodeParameterSchema),
    ),
  );
  setOptional(
    schema,
    'required',
    decodeOptional(raw['required'], atKey(path, 'required'), issues, decodeStringArray),
  );
  setOptional(
    schema,
    'anyOf',
    decodeOptional(raw['anyOf'], atKey(path, 'anyOf'), issues, (member, memberPath, sink) =>
      decodeArray(member, memberPath, sink, decodeParameterSchema),
    ),
  );
  setOptional(
    schema,
    'additionalProperties',
    decodeOptional(
      raw['additionalProperties'],
      atKey(path, 'additionalProperties'),
      issues,
      decodeAdditionalProperties,
    ),
  );
  setOptional(
    schema,
    'minimum',
    decodeOptional(raw['minimum'], atKey(path, 'minimum'), issues, decodeNumber),
  );
  setOptional(
    schema,
    'maximum',
    decodeOptional(raw['maximum'], atKey(path, 'maximum'), issues, decodeNumber),
  );
  setOptional(
    schema,
    'pattern',
    decodeOptional(raw['pattern'], atKey(path, 'pattern'), issues, decodeString),
  );
  setOptional(
    schema,
    'format',
    decodeOptional(raw['format'], atKey(path, 'format'), issues, decodeString),
  );
  setOptional(
    schema,
    'default',
    decodeOptional(raw['default'], atKey(path, 'default'), issues, decodeDefaultValue),
  );
  return schema;
}

/** The root of a tool's parameters: an object node that NAMES its properties. */
function decodeObjectParameterSchema(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IObjectParameterSchema | undefined {
  const schema = decodeParameterSchema(value, path, issues);
  if (schema === undefined) return undefined;
  if (schema.type !== 'object') {
    addIssue(issues, atKey(path, 'type'), "expected the root parameter schema to be type 'object'");
    return undefined;
  }
  if (schema.properties === undefined) {
    addIssue(
      issues,
      atKey(path, 'properties'),
      'expected the root parameter schema to name its properties',
    );
    return undefined;
  }
  return { ...schema, type: 'object', properties: schema.properties };
}

export function decodeToolSchema(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IToolSchema | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'name',
    'description',
    'parameters',
    'outputSchema',
  ]);
  if (raw === undefined) return undefined;
  const name = decodeString(raw['name'], atKey(path, 'name'), issues);
  const description = decodeString(raw['description'], atKey(path, 'description'), issues);
  const parameters = decodeObjectParameterSchema(
    raw['parameters'],
    atKey(path, 'parameters'),
    issues,
  );
  if (name === undefined || description === undefined || parameters === undefined) return undefined;
  const schema: IToolSchema = { name, description, parameters };
  setOptional(
    schema,
    'outputSchema',
    decodeOptional(raw['outputSchema'], atKey(path, 'outputSchema'), issues, decodeParameterSchema),
  );
  return schema;
}
