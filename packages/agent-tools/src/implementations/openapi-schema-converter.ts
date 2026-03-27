import type { IParameterSchema } from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import type { OpenAPIV3 } from 'openapi-types';

/**
 * OpenAPI operation method types
 */
export type THTTPMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';

/**
 * HTTP methods to search when scanning OpenAPI paths
 */
export const HTTP_METHODS: THTTPMethod[] = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
];

/**
 * Find an operation in the OpenAPI spec by operationId
 */
export function findOperation(
  apiSpec: OpenAPIV3.Document,
  operationId: string,
): { method: THTTPMethod; path: string; operation: OpenAPIV3.OperationObject } | undefined {
  for (const [path, pathItem] of Object.entries(apiSpec.paths || {})) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (operation?.operationId === operationId) {
        return { method, path, operation };
      }
    }
  }
  return undefined;
}

/**
 * Map OpenAPI type to JSON schema type
 */
export function mapOpenAPIType(type: string | undefined): IParameterSchema['type'] {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'integer':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

/**
 * Convert OpenAPI schema to parameter schema
 */
export function convertOpenAPISchemaToParameterSchema(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): IParameterSchema {
  // Handle reference objects
  if ('$ref' in schema) {
    // For now, treat references as generic objects
    return { type: 'object' };
  }

  const result: IParameterSchema = {
    type: mapOpenAPIType(schema.type),
  };

  if (schema.description) {
    result.description = schema.description;
  }

  if (schema.enum) {
    result.enum = schema.enum as (string | number | boolean)[];
  }

  if (schema.minimum !== undefined) {
    result.minimum = schema.minimum;
  }

  if (schema.maximum !== undefined) {
    result.maximum = schema.maximum;
  }

  if (schema.pattern) {
    result.pattern = schema.pattern;
  }

  if (schema.format) {
    result.format = schema.format;
  }

  if (schema.default !== undefined) {
    result.default = schema.default;
  }

  // Handle array items
  if (schema.type === 'array' && schema.items) {
    result.items = convertOpenAPISchemaToParameterSchema(schema.items);
  }

  // Handle object properties
  if (schema.type === 'object' && schema.properties) {
    result.properties = {};
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      result.properties[propName] = convertOpenAPISchemaToParameterSchema(propSchema);
    }

    if (schema.required && schema.required.length > 0) {
      (result as { required?: string[] }).required = schema.required;
    }
  }

  return result;
}

/**
 * Convert OpenAPI parameter object to tool parameter schema
 */
export function convertOpenAPIParamToSchema(param: OpenAPIV3.ParameterObject): IParameterSchema {
  const schema = param.schema as OpenAPIV3.SchemaObject;
  return convertOpenAPISchemaToParameterSchema(schema);
}

/**
 * Create a tool schema from an OpenAPI operation specification
 */
export function createSchemaFromOperation(
  operationId: string,
  opSpec: OpenAPIV3.OperationObject,
): IToolSchema {
  const properties: Record<string, IParameterSchema> = {};
  const required: string[] = [];

  // Convert OpenAPI parameters to tool schema
  const params = (opSpec.parameters as OpenAPIV3.ParameterObject[]) || [];
  for (const param of params) {
    properties[param.name] = convertOpenAPIParamToSchema(param);
    if (param.required) {
      required.push(param.name);
    }
  }

  // Handle request body for POST/PUT/PATCH operations
  if (opSpec.requestBody) {
    const requestBody = opSpec.requestBody as OpenAPIV3.RequestBodyObject;
    const jsonContent = requestBody.content?.['application/json'];
    if (jsonContent?.schema) {
      const bodySchema = convertOpenAPISchemaToParameterSchema(jsonContent.schema);
      if (bodySchema.type === 'object' && bodySchema.properties) {
        Object.assign(properties, bodySchema.properties);
        // Handle required properties for object schemas
        const schemaWithRequired = bodySchema as IParameterSchema & { required?: string[] };
        if (schemaWithRequired.required) {
          required.push(...schemaWithRequired.required);
        }
      }
    }
  }

  const schemaParams: {
    type: 'object';
    properties: Record<string, IParameterSchema>;
    required?: string[];
  } = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schemaParams.required = required;
  }

  return {
    name: operationId,
    description: opSpec.summary || opSpec.description || `OpenAPI operation: ${operationId}`,
    parameters: schemaParams,
  };
}
