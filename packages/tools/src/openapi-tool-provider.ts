import { BaseToolProvider, type ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';

/**
 * OpenAPI tool provider options
 */
export interface OpenAPIToolProviderOptions {
    /** OpenAPI spec object or URL */
    openApiSpec: any;
    /** Base URL configuration */
    baseUrl?: string;
    /** Logger function (optional) */
    logger?: (message: string, context?: Record<string, any>) => void;
}

/**
 * OpenAPI-based tool provider class
 */
export class OpenAPIToolProvider extends BaseToolProvider {
    private openApiSpec: any;
    private readonly baseUrl?: string;
    public functions?: FunctionSchema[];

    constructor(options: OpenAPIToolProviderOptions) {
        super({ logger: options.logger });
        this.openApiSpec = options.openApiSpec;
        this.baseUrl = options.baseUrl;
    }

    /**
     * Convert OpenAPI spec to function list
     */
    private convertOpenAPIToFunctions(spec: any): FunctionSchema[] {
        const functions: FunctionSchema[] = [];

        // Convert OpenAPI paths and methods to functions
        for (const path in spec.paths) {
            for (const method in spec.paths[path]) {
                const operation = spec.paths[path][method];
                const functionName = operation.operationId || `${method}${path.replace(/\//g, '_')}`;

                // Generate parameters
                const parameters: Record<string, any> = {};
                const required: string[] = [];

                // Handle path, query, body parameters
                if (operation.parameters) {
                    for (const param of operation.parameters) {
                        parameters[param.name] = {
                            type: param.schema?.type || 'string',
                            description: param.description || `${param.name} parameter`
                        };

                        if (param.required) {
                            required.push(param.name);
                        }
                    }
                }

                // Handle request body
                if (operation.requestBody?.content?.['application/json']?.schema) {
                    const schema = operation.requestBody.content['application/json'].schema;
                    if (schema.properties) {
                        for (const propName in schema.properties) {
                            parameters[propName] = {
                                type: schema.properties[propName].type || 'string',
                                description: schema.properties[propName].description || `${propName} property`
                            };
                        }

                        if (schema.required) {
                            required.push(...schema.required);
                        }
                    }
                }

                functions.push({
                    name: functionName,
                    description: operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
                    parameters: {
                        type: 'object',
                        properties: parameters,
                        required: required.length > 0 ? required : undefined
                    }
                });
            }
        }

        return functions;
    }

    /**
     * Initialize OpenAPI spec (lazy loading)
     */
    private async initializeSpec(): Promise<void> {
        if (this.functions) return; // Already initialized

        try {
            // Fetch OpenAPI spec if it's a URL
            if (typeof this.openApiSpec === 'string') {
                const response = await fetch(this.openApiSpec);
                if (!response.ok) {
                    throw new Error(`Cannot fetch OpenAPI spec: ${response.status} ${response.statusText}`);
                }
                this.openApiSpec = await response.json();
            }

            // Generate function list
            this.functions = this.convertOpenAPIToFunctions(this.openApiSpec);
        } catch (error) {
            throw new Error(`OpenAPI spec initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Tool call implementation
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        // Lazy initialization
        await this.initializeSpec();

        return this.executeToolSafely(toolName, parameters, async () => {
            // API call logic implementation
            const baseUrl = this.baseUrl || '';
            const url = `${baseUrl}/${toolName}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(parameters)
            });

            if (!response.ok) {
                throw new Error(`API call failed: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        });
    }

    /**
     * Return available tool list (override)
     */
    getAvailableTools(): string[] {
        if (!this.functions) {
            // Return empty array if not initialized yet
            return [];
        }
        return super.getAvailableTools();
    }

    /**
     * Check if specific tool exists (override)
     */
    hasTool(toolName: string): boolean {
        if (!this.functions) {
            // Return false if not initialized yet
            return false;
        }
        return super.hasTool(toolName);
    }
}

/**
 * Creates a tool provider based on OpenAPI specifications.
 * 
 * @param openApiSpec OpenAPI spec object or URL
 * @param options Base URL configuration
 * @returns OpenAPI-based tool provider
 */
export function createOpenAPIToolProvider(openApiSpec: any, options?: { baseUrl?: string }): ToolProvider {
    return new OpenAPIToolProvider({
        openApiSpec,
        baseUrl: options?.baseUrl,
    });
} 