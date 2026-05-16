import type { IOpenAIProviderOptions, TOpenAIProviderOptionValue } from './types';
import type {
  IOpenAIResponsesTextConfig,
  IOpenAIResponsesTextFormatJsonSchema,
} from './responses-types';

export interface IOpenAIChatTextFormatText {
  type: 'text';
}

export interface IOpenAIChatTextFormatJsonObject {
  type: 'json_object';
}

export interface IOpenAIChatTextFormatJsonSchema {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, TOpenAIProviderOptionValue>;
    description?: string;
    strict?: boolean;
  };
}

export type TOpenAIChatResponseFormat =
  | IOpenAIChatTextFormatText
  | IOpenAIChatTextFormatJsonObject
  | IOpenAIChatTextFormatJsonSchema;

export function buildOpenAIChatResponseFormat(
  options: IOpenAIProviderOptions,
): TOpenAIChatResponseFormat | undefined {
  if (options.responseFormat === undefined || options.responseFormat === 'text') {
    return undefined;
  }
  if (options.responseFormat === 'json_object') {
    return { type: 'json_object' };
  }

  const schema = requireJsonSchema(options);
  return {
    type: 'json_schema',
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(schema.description !== undefined && { description: schema.description }),
      ...(schema.strict !== undefined && { strict: schema.strict }),
    },
  };
}

export function buildOpenAIResponsesTextConfig(
  options: IOpenAIProviderOptions,
): IOpenAIResponsesTextConfig | undefined {
  if (options.responseFormat === undefined || options.responseFormat === 'text') {
    return undefined;
  }
  if (options.responseFormat === 'json_object') {
    return { format: { type: 'json_object' } };
  }

  const schema = requireJsonSchema(options);
  const format: IOpenAIResponsesTextFormatJsonSchema = {
    type: 'json_schema',
    name: schema.name,
    schema: schema.schema,
    ...(schema.description !== undefined && { description: schema.description }),
    ...(schema.strict !== undefined && { strict: schema.strict }),
  };
  return { format };
}

function requireJsonSchema(input: IOpenAIProviderOptions): {
  name: string;
  schema: Record<string, TOpenAIProviderOptionValue>;
  description?: string;
  strict?: boolean;
} {
  const schema = input.jsonSchema;
  if (input.responseFormat !== 'json_schema') {
    throw new Error(`Unsupported OpenAI response format: ${input.responseFormat}`);
  }
  if (!schema?.schema) {
    throw new Error('OpenAI jsonSchema.schema is required when responseFormat is json_schema');
  }
  return {
    name: schema.name,
    schema: schema.schema,
    ...(schema.description !== undefined && { description: schema.description }),
    ...(schema.strict !== undefined && { strict: schema.strict }),
  };
}
