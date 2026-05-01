import { Type } from '@google/genai';
import type { FunctionDeclaration, Schema } from '@google/genai';
import type { IParameterSchema, IToolSchema, TJSONSchemaKind } from '@robota-sdk/agent-core';

const GOOGLE_SCHEMA_TYPE_BY_JSON_KIND: Record<Exclude<TJSONSchemaKind, 'null'>, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

/** Converts Robota tool schemas to Gemini function declarations. */
export function convertToolsToGeminiFormat(tools: IToolSchema[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: Type.OBJECT,
      properties: convertParameterProperties(tool.parameters.properties),
      required: tool.parameters.required,
    },
  }));
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

function convertParameterSchema(schema: IParameterSchema): Schema {
  const convertedSchema: Schema = {};
  const schemaType = convertSchemaKind(schema.type);
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
  if (typeof schema.minimum === 'number') {
    convertedSchema.minimum = schema.minimum;
  }
  if (typeof schema.maximum === 'number') {
    convertedSchema.maximum = schema.maximum;
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
