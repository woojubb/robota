import type { IToolSchema } from './provider';
import type { ITool, TToolExecutor } from './tool';
import type { IFunctionTool } from './tool';

/**
 * OpenAPI specification configuration
 */
export interface IOpenAPIToolConfig {
  /** OpenAPI 3.0 specification */
  spec: {
    openapi: string;
    info: {
      title: string;
      version: string;
      description?: string;
    };
    servers?: Array<{
      url: string;
      description?: string;
    }>;
    paths: Record<
      string,
      Record<string, string | number | boolean | Record<string, string | number | boolean>>
    >;
    components?: Record<string, Record<string, string | number | boolean>>;
  };
  /** Operation ID from the OpenAPI spec */
  operationId: string;
  /** Base URL for API calls */
  baseURL: string;
  /** Authentication configuration */
  auth?: {
    type: 'bearer' | 'apiKey' | 'basic';
    token?: string;
    apiKey?: string;
    header?: string;
    username?: string;
    password?: string;
  };
}

/**
 * Tool factory interface
 */
export interface IToolFactory {
  /**
   * Create function tool from schema and function
   */
  createFunctionTool(schema: IToolSchema, fn: TToolExecutor): IFunctionTool;

  /**
   * Create tool from OpenAPI specification
   */
  createOpenAPITool(config: IOpenAPIToolConfig): ITool;
}
