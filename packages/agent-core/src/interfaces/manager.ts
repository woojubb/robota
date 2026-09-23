import type { IAIProvider, IToolSchema } from './provider';
import type { ITool, TToolExecutor, IToolExecutionContext, TToolParameters } from './tool';
import type { TUniversalValue } from './types';

/**
 * Reusable type definitions for manager layer
 */

/**
 * Tool execution parameters for manager operations
 * Used for tool parameter validation and execution in manager context
 */
export type TManagerToolParameters = Record<
  string,
  string | number | boolean | string[] | number[] | boolean[]
>;

/**
 * AI Provider Manager interface for provider registration and selection
 */
export interface IAIProviderManager {
  /**
   * Register an AI provider
   */
  addProvider(name: string, provider: IAIProvider): void;

  /**
   * Remove an AI provider
   */
  removeProvider(name: string): void;

  /**
   * Get registered provider by name
   */
  getProvider(name: string): IAIProvider | undefined;

  /**
   * Get all registered providers
   */
  getProviders(): Record<string, IAIProvider>;

  /**
   * Set current provider and model
   */
  setCurrentProvider(name: string, model: string): void;

  /**
   * Get current provider and model
   */
  getCurrentProvider(): { provider: string; model: string } | undefined;

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean;
}

/**
 * Tool Manager interface for tool registration and management
 */
export interface IToolManager {
  /**
   * Register a tool
   */
  addTool(schema: IToolSchema, executor: TToolExecutor): void;

  /**
   * Remove a tool by name
   */
  removeTool(name: string): void;

  /**
   * Get tool interface by name
   */
  getTool(name: string): ITool | undefined;

  /**
   * Get tool schema by name
   */
  getToolSchema(name: string): IToolSchema | undefined;

  /**
   * Get all registered tools
   */
  getTools(): IToolSchema[];

  /**
   * CLI-1990: the schemas the model is offered at the next request — every registered tool while
   * deferral is not engaged; the resident ones plus the loaded deferred ones once it is. Read per
   * round by the execution loop; it is never a snapshot.
   */
  getOfferedTools(): IToolSchema[];

  /** CLI-1990: whether a call to this tool would execute now — registered AND offered. */
  isToolOffered(name: string): boolean;

  /**
   * CLI-1990: deferred tools not yet loaded — the population a search discovers. Empty while
   * deferral is not engaged. The same member `IDeferredToolCatalog` declares.
   */
  listDeferredTools(): IToolSchema[];

  /**
   * CLI-1990: mark deferred tools loaded for the rest of the session and return their schemas; an
   * unknown name throws, naming it, before anything is loaded. The same member
   * `IDeferredToolCatalog` declares.
   */
  loadDeferredTools(names: readonly string[]): IToolSchema[];

  /**
   * Execute a tool
   */
  executeTool(
    name: string,
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<TUniversalValue>;

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean;

  /**
   * Set allowed tools (for filtering)
   */
  setAllowedTools(tools: string[]): void;

  /**
   * Get allowed tools
   */
  getAllowedTools(): string[] | undefined;
}
