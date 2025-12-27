import type { IToolInterface, IToolResult, IToolExecutionContext, IOpenAPIToolConfig, TToolParameters, TToolParameterValue } from '../../interfaces/tool';
import type { IToolSchema, IParameterSchema } from '../../interfaces/provider';
import type { OpenAPIV3 } from 'openapi-types';
import { AbstractTool, type IAbstractToolOptions } from '../../abstracts/abstract-tool';
import { ToolExecutionError, ValidationError } from '../../utils/errors';

/**
 * OpenAPI operation method types
 */
type THTTPMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';
/**
 * OpenAPI tool implementation
 * Executes API calls based on OpenAPI 3.0 specifications
 * 
 * @extends AbstractTool<ToolParameters, ToolResult>
 */
export class OpenAPITool extends AbstractTool<TToolParameters, IToolResult> implements IToolInterface {
    readonly schema: IToolSchema;
    private readonly apiSpec: OpenAPIV3.Document;
    private readonly operationId: string;
    private readonly baseURL: string;
    private readonly config: IOpenAPIToolConfig;

    constructor(config: IOpenAPIToolConfig, options: IAbstractToolOptions = {}) {
        super(options);
        this.config = config;
        this.apiSpec = config.spec as OpenAPIV3.Document;
        this.operationId = config.operationId;
        this.baseURL = config.baseURL;
        this.schema = this.createSchemaFromOpenAPI();
    }

    /**
     * Execute the OpenAPI tool implementation
     * This method is called by the parent's Template Method Pattern
     */
    protected async executeImpl(parameters: TToolParameters, context?: IToolExecutionContext): Promise<IToolResult> {
        const toolName = this.schema.name;

        try {
            // Validate parameters
            const validation = this.validateParameters(parameters);
            if (!validation.isValid) {
                throw new ValidationError(`Invalid parameters for OpenAPI tool "${toolName}": ${validation.errors.join(', ')}`);
            }

            this.logger.debug(`Executing OpenAPI tool "${toolName}"`, {
                toolName,
                operationId: this.operationId,
                baseURL: this.baseURL,
                parametersCount: Object.keys(parameters).length
            });

            // Execute the API call
            const startTime = Date.now();
            const result = await this.executeAPICall(parameters, context);
            const executionTime = Date.now() - startTime;

            this.logger.debug(`OpenAPI tool "${toolName}" executed successfully`, {
                toolName,
                executionTime,
                resultType: typeof result
            });

            return {
                success: true,
                data: result,
                metadata: {
                    executionTime,
                    toolName,
                    operationId: this.operationId,
                    baseURL: this.baseURL
                }
            };

        } catch (error) {
            this.logger.error(`OpenAPI tool "${toolName}" execution failed`, {
                toolName,
                operationId: this.operationId,
                error: error instanceof Error ? error.message : error,
                parameters
            });

            if (error instanceof ToolExecutionError || error instanceof ValidationError) {
                throw error;
            }

            throw new ToolExecutionError(
                `OpenAPI tool execution failed: ${error instanceof Error ? error.message : error}`,
                toolName,
                error instanceof Error ? error : new Error(String(error)),
                {
                    operationId: this.operationId,
                    baseURL: this.baseURL,
                    parametersCount: Object.keys(parameters).length
                }
            );
        }
    }

    /**
     * Execute the actual API call
     * @private
     */
    private async executeAPICall(parameters: TToolParameters, _context?: IToolExecutionContext) {
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
            message: `OpenAPI tool "${this.schema.name}" executed`,
            operationId: this.operationId,
            method: requestConfig.method,
            url: requestConfig.url,
            parameters,
            timestamp: new Date().toISOString()
        };

        return result;
    }

    /**
     * Find the operation in the OpenAPI specification
     */
    private findOperation(): { method: THTTPMethod; path: string; operation: OpenAPIV3.OperationObject } | null {
        for (const [path, pathItem] of Object.entries(this.apiSpec.paths || {})) {
            if (!pathItem) continue;

            for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as THTTPMethod[]) {
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
        opInfo: { method: THTTPMethod; path: string; operation: OpenAPIV3.OperationObject },
        parameters: TToolParameters
    ): { method: THTTPMethod; url: string; headers: Record<string, string>; body?: string } {
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
                const bodyParams: Record<string, TToolParameterValue> = {};
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

        const result: { method: THTTPMethod; url: string; headers: Record<string, string>; body?: string } = {
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
    private createSchemaFromOpenAPI(): IToolSchema {
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
        const properties: Record<string, IParameterSchema> = {};
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
                    const schemaWithRequired = bodySchema as IParameterSchema & { required?: string[] };
                    if (schemaWithRequired.required) {
                        required.push(...schemaWithRequired.required);
                    }
                }
            }
        }

        const schemaParams: { type: 'object'; properties: Record<string, IParameterSchema>; required?: string[] } = {
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
    private convertOpenAPIParamToSchema(param: OpenAPIV3.ParameterObject): IParameterSchema {
        const schema = param.schema as OpenAPIV3.SchemaObject;
        return this.convertOpenAPISchemaToParameterSchema(schema);
    }

    /**
     * Convert OpenAPI schema to parameter schema
     */
    private convertOpenAPISchemaToParameterSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): IParameterSchema {
        // Handle reference objects
        if ('$ref' in schema) {
            // For now, treat references as generic objects
            return { type: 'object' };
        }

        const result: IParameterSchema = {
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
    private mapOpenAPIType(type: string | undefined): IParameterSchema['type'] {
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
export function createOpenAPITool(config: IOpenAPIToolConfig): OpenAPITool {
    return new OpenAPITool(config);
} 