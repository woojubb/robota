import { FunctionCallingConfigMode, Type } from '@google/genai';

import type { FunctionCallingConfig, FunctionDeclaration, Schema } from '@google/genai';
import type {
  IParameterSchema,
  IToolSchema,
  TJSONSchemaKind,
  TToolChoice,
} from '@robota-sdk/agent-core';

const GOOGLE_SCHEMA_TYPE_BY_JSON_KIND: Record<Exclude<TJSONSchemaKind, 'null'>, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

/** Converts agent runtime tool schemas to Gemini function declarations. */
export function convertToolsToGeminiFormat(tools: IToolSchema[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // The member is optional, and the API has answered `should be non-empty for OBJECT type`.
    ...(Object.keys(tool.parameters.properties).length > 0 && {
      parameters: convertParameterSchema(tool.parameters),
    }),
  }));
}

/**
 * Map the provider-agnostic tool-invocation directive onto Gemini's
 * `functionCallingConfig` (CORE-017). `'required'` maps to mode `ANY` (the model must call
 * some declared function); a named directive maps to `ANY` constrained to that one name.
 */
export function toGeminiFunctionCallingConfig(toolChoice: TToolChoice): FunctionCallingConfig {
  if (toolChoice === 'auto') {
    return { mode: FunctionCallingConfigMode.AUTO };
  }
  if (toolChoice === 'none') {
    return { mode: FunctionCallingConfigMode.NONE };
  }
  if (toolChoice === 'required') {
    return { mode: FunctionCallingConfigMode.ANY };
  }
  return { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [toolChoice.tool] };
}

function convertParameterProperties(
  properties: Record<string, IParameterSchema>,
): Record<string, Schema> {
  const convertedProperties: Record<string, Schema> = {};
  for (const [key, value] of Object.entries(properties)) {
    convertedProperties[key] = convertParameterSchema(value);
  }
  return convertedProperties;
}

function admitsOnlyNull(schema: IParameterSchema): boolean {
  return schema.type === 'null' || schema.anyOf?.every(admitsOnlyNull) === true;
}

/**
 * A union's null branch, as Gemini's `nullable`. The backend has no null type, and an untyped `{}`
 * branch is what it reads as a missing field. One remaining branch stands for the union when nothing
 * but annotations sits beside it, which is also how `@google/genai` converts JSON Schema; a
 * constraint beside `anyOf` applies together with the branch, so overwriting the branch's own would
 * show the model a shape local validation refuses.
 */
function convertNullableUnion(schema: IParameterSchema, branches: IParameterSchema[]): Schema {
  const { anyOf: _anyOf, ...members } = schema;
  const nothingButAnnotations = Object.keys(members).every(
    (key) => key === 'description' || key === 'default',
  );
  const nonNull =
    branches.length === 1 && nothingButAnnotations
      ? { ...branches[0], ...members }
      : { ...members, anyOf: branches };
  return { ...convertParameterSchema(nonNull), nullable: true };
}

/** Only `null` is valid here, and Gemini needs a type to put `nullable` on. */
function convertOnlyNull(schema: IParameterSchema): Schema {
  return {
    type: Type.STRING,
    nullable: true,
    ...(schema.description && { description: schema.description }),
  };
}

function convertParameterSchema(schema: IParameterSchema): Schema {
  if (admitsOnlyNull(schema)) return convertOnlyNull(schema);
  const branches = schema.anyOf?.filter((branch) => !admitsOnlyNull(branch));
  if (branches !== undefined && branches.length !== schema.anyOf?.length) {
    return convertNullableUnion(schema, branches);
  }
  const convertedSchema: Schema = {};
  const schemaType = schema.type ? convertSchemaKind(schema.type) : undefined;
  if (schemaType) {
    convertedSchema.type = schemaType;
  }
  if (schema.description) {
    convertedSchema.description = schema.description;
  }
  if (schema.enum) {
    convertedSchema.enum = schema.enum.map(String);
  }
  if (schema.items) {
    convertedSchema.items = convertParameterSchema(schema.items);
  }
  if (schema.properties) {
    convertedSchema.properties = convertParameterProperties(schema.properties);
  }
  // CORE-039: this mapper rebuilds every node from a fixed key list, so a subset member it does not
  // copy is silently dropped. `required` below a nested object, and `anyOf` anywhere, are members
  // Gemini's own Schema carries — omitting them told the model every nested field was optional and
  // erased union branches entirely.
  if (schema.required) {
    // A name `properties` does not declare is answered with `property is not defined`.
    const declared = schema.required.filter((name) =>
      Object.prototype.hasOwnProperty.call(schema.properties ?? {}, name),
    );
    if (declared.length > 0) convertedSchema.required = declared;
  }
  if (schema.anyOf) {
    convertedSchema.anyOf = schema.anyOf.map(convertParameterSchema);
  }
  if (typeof schema.minimum === 'number') {
    convertedSchema.minimum = schema.minimum;
  }
  if (typeof schema.maximum === 'number') {
    convertedSchema.maximum = schema.maximum;
  }
  // Gemini types its counts as strings: int64 in proto3 JSON.
  if (typeof schema.minLength === 'number') {
    convertedSchema.minLength = String(schema.minLength);
  }
  if (typeof schema.maxLength === 'number') {
    convertedSchema.maxLength = String(schema.maxLength);
  }
  if (typeof schema.minItems === 'number') {
    convertedSchema.minItems = String(schema.minItems);
  }
  if (typeof schema.maxItems === 'number') {
    convertedSchema.maxItems = String(schema.maxItems);
  }
  if (typeof schema.minProperties === 'number') {
    convertedSchema.minProperties = String(schema.minProperties);
  }
  if (typeof schema.maxProperties === 'number') {
    convertedSchema.maxProperties = String(schema.maxProperties);
  }
  if (schema.pattern) {
    convertedSchema.pattern = schema.pattern;
  }
  if (schema.format) {
    convertedSchema.format = schema.format;
  }
  if (schema.default !== undefined) {
    convertedSchema.default = schema.default;
  }
  return convertedSchema;
}

function convertSchemaKind(kind: TJSONSchemaKind): Type | undefined {
  if (kind === 'null') {
    return undefined;
  }
  return GOOGLE_SCHEMA_TYPE_BY_JSON_KIND[kind];
}
