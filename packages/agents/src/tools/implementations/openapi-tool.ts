import type { ToolInterface, ToolResult, ToolExecutionContext, OpenAPIToolConfig, ToolParameters, ToolParameterValue } from '../../interfaces/tool';
import type { ToolSchema, ParameterSchema } from '../../interfaces/provider';
import type { OpenAPIV3 } from 'openapi-types';
import { BaseTool } from '../../abstracts/base-tool';
import { ToolExecutionError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * OpenAPI operation method types
 */
type HTTPMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';



/**
 * OpenAPI tool implementation
 * Executes API calls based on OpenAPI 3.0 specifications
 */
export class OpenAPITool extends BaseTool implements ToolInterface {
    readonly schema: ToolSchema;
    private readonly apiSpec: OpenAPIV3.Document;
    private readonly operationId: string;
    private readonly baseURL: string;
    private readonly config: OpenAPIToolConfig;

    constructor(config: OpenAPIToolConfig) {
        super();
        this.config = config;
        this.apiSpec = config.spec as OpenAPIV3.Document;
        this.operationId = config.operationId;
        this.baseURL = config.baseURL;
        this.schema = this.createSchemaFromOpenAPI();
    }

    /**
     * Execute the OpenAPI operation
     */
    async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
        const toolName = this.schema.name;

        try {
            logger.debug(`Executing OpenAPI tool "${toolName}"`, {
                toolName,
                parameters,
                baseURL: this.baseURL,
                operationId: this.operationId
            });

            // Find the operation in the OpenAPI spec
            const operation = this.findOperation();
            if (!operation) {
                throw new Error(`Operation ${this.operationId} not found in OpenAPI spec`);
            }

            // Build the HTTP request
            const requestConfig = this.buildRequestConfig(operation, parameters);

            // TODO: Implement actual HTTP request execution
            // This would typically use fetch() or axios
            const result = {
                message: `OpenAPI tool "${toolName}" executed`,
                operationId: this.operationId,
                method: requestConfig.method,
                url: requestConfig.url,
                parameters,
                timestamp: new Date().toISOString()
            };

            return {
                success: true,
                data: result,
                metadata: {
                    toolName,
                    toolType: 'openapi',
                    operationId: this.operationId,
                    baseURL: this.baseURL,
                    method: requestConfig.method
                }
            };

        } catch (error) {
            logger.error(`OpenAPI tool "${toolName}" execution failed`, {
                toolName,
                operationId: this.operationId,
                error: error instanceof Error ? error.message : String(error)
            });

            throw new ToolExecutionError(
                `OpenAPI execution failed: ${error instanceof Error ? error.message : String(error)}`,
                toolName,
                error instanceof Error ? error : new Error(String(error)),
                { parameters, context, operationId: this.operationId, baseURL: this.baseURL }
            );
        }
    }

    /**
     * Find the operation in the OpenAPI specification
     */
    private findOperation(): { method: HTTPMethod; path: string; operation: OpenAPIV3.OperationObject } | null {
        for (const [path, pathItem] of Object.entries(this.apiSpec.paths || {})) {
            if (!pathItem) continue;

            for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as HTTPMethod[]) {
                const operation = pathItem[method];
                if (operation?.operationId === this.operationId) {
                    return { method, path, operation };
                }
            }
        }
        return null;
    }

    /**
     * Build HTTP request configuration from OpenAPI operation and parameters
     */
    private buildRequestConfig(
        opInfo: { method: HTTPMethod; path: string; operation: OpenAPIV3.OperationObject },
        parameters: ToolParameters
    ): { method: HTTPMethod; url: string; headers: Record<string, string>; body?: string } {
        const { method, path, operation } = opInfo;

        let url = this.baseURL + path;
        const headers: Record<string, string> = {};
        let body: string | undefined;

        // Process parameters based on their location
        const params = operation.parameters as OpenAPIV3.ParameterObject[] || [];

        for (const param of params) {
            const value = parameters[param.name];
            if (value === undefined && param.required) {
                throw new Error(`Required parameter ${param.name} is missing`);
            }

            if (value !== undefined) {
                switch (param.in) {
                    case 'path':
                        url = url.replace(`{${param.name}}`, String(value));
                        break;
                    case 'query': {
                        const separator = url.includes('?') ? '&' : '?';
                        url += `${separator}${param.name}=${encodeURIComponent(String(value))}`;
                        break;
                    }
                    case 'header':
                        headers[param.name] = String(value);
                        break;
                }
            }
        }

        // Handle request body for POST/PUT/PATCH operations
        if (['post', 'put', 'patch'].includes(method) && operation.requestBody) {
            const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
            const jsonContent = requestBody.content?.['application/json'];
            if (jsonContent) {
                headers['Content-Type'] = 'application/json';
                // Extract body parameters (those not in path/query/header)
                const bodyParams: Record<string, ToolParameterValue> = {};
                for (const [key, value] of Object.entries(parameters)) {
                    const isParamUsed = params.some(p => p.name === key);
                    if (!isParamUsed) {
                        bodyParams[key] = value;
                    }
                }
                body = JSON.stringify(bodyParams);
            }
        }

        // Add authentication headers if configured
        if (this.config.auth) {
            switch (this.config.auth.type) {
                case 'bearer':
                    headers['Authorization'] = `Bearer ${this.config.auth.token}`;
                    break;
                case 'apiKey': {
                    const headerName = this.config.auth.header || 'X-API-Key';
                    headers[headerName] = this.config.auth.apiKey || '';
                    break;
                }
            }
        }

        const result: { method: HTTPMethod; url: string; headers: Record<string, string>; body?: string } = {
            method,
            url,
            headers
        };

        if (body !== undefined) {
            result.body = body;
        }

        return result;
    }

    /**
     * Create tool schema from OpenAPI operation specification
     */
    private createSchemaFromOpenAPI(): ToolSchema {
        const operation = this.findOperation();
        if (!operation) {
            // Fallback schema if operation not found
            return {
                name: this.operationId,
                description: `OpenAPI operation: ${this.operationId}`,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            };
        }

        const { operation: opSpec } = operation;
        const properties: Record<string, ParameterSchema> = {};
        const required: string[] = [];

        // Convert OpenAPI parameters to tool schema
        const params = opSpec.parameters as OpenAPIV3.ParameterObject[] || [];
        for (const param of params) {
            properties[param.name] = this.convertOpenAPIParamToSchema(param);
            if (param.required) {
                required.push(param.name);
            }
        }

        // Handle request body for POST/PUT/PATCH operations
        if (opSpec.requestBody) {
            const requestBody = opSpec.requestBody as OpenAPIV3.RequestBodyObject;
            const jsonContent = requestBody.content?.['application/json'];
            if (jsonContent?.schema) {
                const bodySchema = this.convertOpenAPISchemaToParameterSchema(jsonContent.schema);
                if (bodySchema.type === 'object' && bodySchema.properties) {
                    Object.assign(properties, bodySchema.properties);
                    // Handle required properties for object schemas
                    const schemaWithRequired = bodySchema as ParameterSchema & { required?: string[] };
                    if (schemaWithRequired.required) {
                        required.push(...schemaWithRequired.required);
                    }
                }
            }
        }

        const schemaParams: { type: 'object'; properties: Record<string, ParameterSchema>; required?: string[] } = {
            type: 'object',
            properties
        };

        if (required.length > 0) {
            schemaParams.required = required;
        }

        return {
            name: this.operationId,
            description: opSpec.summary || opSpec.description || `OpenAPI operation: ${this.operationId}`,
            parameters: schemaParams
        };
    }

    /**
     * Convert OpenAPI parameter to tool parameter schema
     */
    private convertOpenAPIParamToSchema(param: OpenAPIV3.ParameterObject): ParameterSchema {
        const schema = param.schema as OpenAPIV3.SchemaObject;
        return this.convertOpenAPISchemaToParameterSchema(schema);
    }

    /**
     * Convert OpenAPI schema to parameter schema
     */
    private convertOpenAPISchemaToParameterSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): ParameterSchema {
        // Handle reference objects
        if ('$ref' in schema) {
            // For now, treat references as generic objects
            return { type: 'object' };
        }

        const result: ParameterSchema = {
            type: this.mapOpenAPIType(schema.type)
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
            result.items = this.convertOpenAPISchemaToParameterSchema(schema.items);
        }

        // Handle object properties
        if (schema.type === 'object' && schema.properties) {
            result.properties = {};
            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                result.properties[propName] = this.convertOpenAPISchemaToParameterSchema(propSchema);
            }

            if (schema.required && schema.required.length > 0) {
                (result as { required?: string[] }).required = schema.required;
            }
        }

        return result;
    }

    /**
     * Map OpenAPI type to JSON schema type
     */
    private mapOpenAPIType(type: string | undefined): ParameterSchema['type'] {
        switch (type) {
            case 'string': return 'string';
            case 'number': return 'number';
            case 'integer': return 'integer';
            case 'boolean': return 'boolean';
            case 'array': return 'array';
            case 'object': return 'object';
            default: return 'string';
        }
    }
}

/**
 * Factory function to create OpenAPI tools from specification
 */
export function createOpenAPITool(config: OpenAPIToolConfig): OpenAPITool {
    return new OpenAPITool(config);
} 