import { ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';

/**
 * Create tool provider based on OpenAPI specification
 * 
 * @param openApiSpec OpenAPI specification object or URL
 * @param options Base URL configuration
 * @returns OpenAPI-based tool provider
 */
export function createOpenAPIToolProvider(openApiSpec: any, options?: { baseUrl?: string }): ToolProvider {
    // Logic to convert OpenAPI specification to functions
    const convertOpenAPIToFunctions = (spec: any) => {
        const functions: FunctionSchema[] = [];

        // Convert OpenAPI paths and methods to functions
        for (const path in spec.paths) {
            for (const method in spec.paths[path]) {
                const operation = spec.paths[path][method];
                const functionName = operation.operationId || `${method}${path.replace(/\//g, '_')}`;

                // Generate parameters
                const parameters: Record<string, any> = {};
                const required: string[] = [];

                // Handle path, query, and body parameters
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
    };

    // Function list (lazy initialization)
    let apiFunctions: FunctionSchema[] | null = null;
    // OpenAPI spec (lazy initialization)
    let apiSpec: any = null;

    // Create tool provider object
    const provider: ToolProvider = {
        // Tool call implementation
        async callTool(toolName, parameters) {
            try {
                // Initialize OpenAPI specification if needed
                if (!apiSpec) {
                    apiSpec = typeof openApiSpec === 'string'
                        ? await fetch(openApiSpec).then(res => res.json())
                        : openApiSpec;

                    apiFunctions = convertOpenAPIToFunctions(apiSpec);
                    provider.functions = apiFunctions;
                }

                // Find API endpoint corresponding to tool name
                const toolFunction = apiFunctions?.find(fn => fn.name === toolName);
                if (!toolFunction) {
                    throw new Error(`Tool '${toolName}' not found.`);
                }

                // Implement actual API call logic here
                // Example: API call using fetch
                const baseUrl = options?.baseUrl || '';
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
            } catch (error) {
                console.error(`Error calling tool '${toolName}':`, error);
                throw new Error(`Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    };

    return provider;
} 