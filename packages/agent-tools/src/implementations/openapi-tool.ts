import type {
  ITool,
  IToolResult,
  IToolExecutionContext,
  IOpenAPIToolConfig,
  TToolParameters,
  IParameterValidationResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { IToolSchema } from '@robota-sdk/agent-core';
import type { OpenAPIV3 } from 'openapi-types';
import { ToolExecutionError, ValidationError } from '@robota-sdk/agent-core';
import {
  type THTTPMethod,
  findOperation,
  createSchemaFromOperation,
} from './openapi-schema-converter';

/**
 * OpenAPI tool implementation
 * Executes API calls based on OpenAPI 3.0 specifications
 *
 * Implements ITool without extending AbstractTool to avoid
 * circular runtime dependency (tools → agents → tools).
 */
export class OpenAPITool implements ITool {
  readonly schema: IToolSchema;
  private readonly apiSpec: OpenAPIV3.Document;
  private readonly operationId: string;
  private readonly baseURL: string;
  private readonly config: IOpenAPIToolConfig;
  private eventService: IEventService | undefined;

  constructor(config: IOpenAPIToolConfig) {
    this.config = config;
    // Runtime validation of required OpenAPI 3.x fields before cast
    if (
      typeof config.spec !== 'object' ||
      config.spec === null ||
      typeof config.spec.openapi !== 'string' ||
      typeof config.spec.paths !== 'object'
    ) {
      throw new Error(
        'Invalid OpenAPI spec: must contain "openapi" (string) and "paths" (object) fields',
      );
    }
    this.apiSpec = config.spec as OpenAPIV3.Document;
    this.operationId = config.operationId;
    this.baseURL = config.baseURL;
    this.schema = this.createSchemaFromOpenAPI();
  }

  /**
   * Execute the OpenAPI tool
   */
  async execute(
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<IToolResult> {
    const toolName = this.schema.name;

    // Validate parameters
    const validation = this.validateParameters(parameters);
    if (!validation.isValid) {
      throw new ValidationError(
        `Invalid parameters for OpenAPI tool "${toolName}": ${validation.errors.join(', ')}`,
      );
    }

    try {
      // Execute the API call
      const startTime = Date.now();
      const result = await this.executeAPICall(parameters, context);
      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: result,
        metadata: {
          executionTime,
          toolName,
          operationId: this.operationId,
          baseURL: this.baseURL,
        },
      };
    } catch (error) {
      if (error instanceof ToolExecutionError || error instanceof ValidationError) {
        throw error;
      }

      const safeError = error instanceof Error ? error : new Error(String(error));
      throw new ToolExecutionError(
        `OpenAPI tool execution failed: ${safeError.message}`,
        toolName,
        safeError,
        {
          operationId: this.operationId,
          baseURL: this.baseURL,
          parametersCount: Object.keys(parameters).length,
        },
      );
    }
  }

  /**
   * Validate tool parameters
   */
  validate(parameters: TToolParameters): boolean {
    return this.validateParameters(parameters).isValid;
  }

  /**
   * Validate tool parameters with detailed result
   */
  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    const required = this.schema.parameters.required || [];
    const errors: string[] = [];

    for (const field of required) {
      if (!(field in parameters)) {
        errors.push(`Missing required parameter: ${field}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get tool name
   */
  getName(): string {
    return this.schema.name;
  }

  /**
   * Set EventService for post-construction injection.
   */
  setEventService(eventService: IEventService | undefined): void {
    this.eventService = eventService;
  }

  /**
   * Get tool description
   */
  getDescription(): string {
    return this.schema.description;
  }

  /**
   * Execute the actual API call
   * @private
   */
  private async executeAPICall(
    parameters: TToolParameters,
    _context?: IToolExecutionContext,
  ): Promise<never> {
    // Find the operation in the OpenAPI spec
    const operation = findOperation(this.apiSpec, this.operationId);
    if (!operation) {
      throw new Error(`Operation ${this.operationId} not found in OpenAPI spec`);
    }

    // Build the HTTP request
    this.buildRequestConfig(operation, parameters);

    throw new Error('Not implemented: actual API execution is not yet available');
  }

  /**
   * Build HTTP request configuration from OpenAPI operation and parameters
   */
  private buildRequestConfig(
    opInfo: { method: THTTPMethod; path: string; operation: OpenAPIV3.OperationObject },
    parameters: TToolParameters,
  ): { method: THTTPMethod; url: string; headers: Record<string, string>; body?: string } {
    const { method, path, operation } = opInfo;

    let url = this.baseURL + path;
    const headers: Record<string, string> = {};
    let body: string | undefined;

    // Process parameters based on their location
    const params = (operation.parameters as OpenAPIV3.ParameterObject[]) || [];

    for (const param of params) {
      const value = parameters[param.name];
      if (value === undefined && param.required) {
        throw new Error(`Required parameter ${param.name} is missing`);
      }

      if (value !== undefined) {
        switch (param.in) {
          case 'path':
            url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)));
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
        const bodyParams: TToolParameters = {};
        for (const [key, value] of Object.entries(parameters)) {
          const isParamUsed = params.some((p) => p.name === key);
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

    const result: {
      method: THTTPMethod;
      url: string;
      headers: Record<string, string>;
      body?: string;
    } = {
      method,
      url,
      headers,
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
    const operation = findOperation(this.apiSpec, this.operationId);
    if (!operation) {
      throw new Error(
        `[STRICT-POLICY][EMITTER-CONTRACT] OpenAPI operation not found: ${this.operationId}. ` +
          `Emitter contract must provide a valid operationId present in the OpenAPI document.`,
      );
    }

    return createSchemaFromOperation(this.operationId, operation.operation);
  }
}

/**
 * Factory function to create OpenAPI tools from specification
 */
export function createOpenAPITool(config: IOpenAPIToolConfig): OpenAPITool {
  return new OpenAPITool(config);
}
