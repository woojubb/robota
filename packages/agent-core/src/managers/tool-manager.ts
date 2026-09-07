import { AbstractManager } from '../abstracts/abstract-manager';
import { ToolRegistry, FunctionTool, isDeferredTool, projectOfferedTools } from '../tool-registry';
import { ToolExecutionError } from '../utils/errors';
import { logger } from '../utils/logger';

import type { IToolManager } from '../interfaces/manager';
import type { IToolSchema } from '../interfaces/provider';
import type {
  ITool,
  TToolExecutor,
  TToolParameters,
  IToolExecutionContext,
} from '../interfaces/tool';
import type { TToolSearchMode } from '../interfaces/tool-search';
import type { TUniversalValue } from '../interfaces/types';

/**
 * What a tool manager is constructed with (CLI-1990).
 *
 * The manager owns the residency STATE — which deferred tools have been loaded — but not the policy
 * that decides whether deferral is engaged: that is a function of the agent's config, its model and
 * the registered set, all of which the agent owns. The policy is read through this resolver on
 * every projection and never cached, so a config or model change is reflected by the next read.
 */
export interface IToolManagerOptions {
  resolveToolSearchMode: () => TToolSearchMode;
}

/**
 * Tool Manager - manages tool registration and execution
 * Manages tool registration and execution using Tool Registry
 * Instance-based for isolated tool management
 * @internal
 */
export class Tools extends AbstractManager implements IToolManager {
  private registry: ToolRegistry;
  private allowedTools?: string[];
  private readonly resolveToolSearchMode: () => TToolSearchMode;
  /** Deferred tools loaded so far this session — by the search tool, or by a forcing `toolChoice`. */
  private readonly loadedDeferredTools = new Set<string>();

  constructor(options: IToolManagerOptions) {
    // CORE-045: `doInitialize` below only logs, so this registry is usable the moment it exists.
    // Without this declaration `Robota.registerTool()` threw on every freshly constructed agent,
    // because the only thing that awaited `initialize()` was the first run.
    super({ readyOnConstruction: true });
    this.registry = new ToolRegistry();
    this.resolveToolSearchMode = options.resolveToolSearchMode;
  }

  /**
   * Initialize the manager
   */
  protected async doInitialize(): Promise<void> {
    logger.debug('Tools initialized');
  }

  /**
   * Cleanup manager resources
   */
  protected async doDispose(): Promise<void> {
    this.registry.clear();
    this.loadedDeferredTools.clear();
    delete this.allowedTools;
    logger.debug('Tools disposed');
  }

  /**
   * Register a tool with schema and executor function
   */
  addTool(schema: IToolSchema, executor: TToolExecutor): void {
    this.ensureInitialized();

    const tool = new FunctionTool(schema, executor);
    this.registry.register(tool);

    logger.debug(`Tool "${schema.name}" registered successfully`);
  }

  /**
   * Remove a tool by name
   */
  removeTool(name: string): void {
    this.ensureInitialized();
    this.registry.unregister(name);
  }

  /**
   * Get tool interface by name
   */
  getTool(name: string): ITool | undefined {
    this.ensureInitialized();
    return this.registry.get(name);
  }

  /**
   * Get tool schema by name
   */
  getToolSchema(name: string): IToolSchema | undefined {
    this.ensureInitialized();
    const tool = this.registry.get(name);
    return tool?.schema;
  }

  /**
   * Get all registered tool schemas
   */
  getTools(): IToolSchema[] {
    this.ensureInitialized();

    const schemas = this.registry.getSchemas();

    // Filter by allowed tools if set
    if (this.allowedTools) {
      return schemas.filter((schema) => this.allowedTools!.includes(schema.name));
    }

    return schemas;
  }

  /**
   * The schemas the model is offered at the next request (CLI-1990): every registered tool while
   * deferral is not engaged; the resident ones plus the loaded deferred ones once it is. Read per
   * round by the execution loop — never a snapshot — and refused, not sent, when it would be empty
   * over a non-empty registry (`projectOfferedTools`).
   */
  getOfferedTools(): IToolSchema[] {
    return projectOfferedTools(
      this.getTools(),
      this.loadedDeferredTools,
      this.resolveToolSearchMode(),
    );
  }

  /** Whether a call to this tool would execute now: registered, and offered by the projection. */
  isToolOffered(name: string): boolean {
    return this.getOfferedTools().some((schema) => schema.name === name);
  }

  /** Deferred tools not yet loaded — the population a search discovers. Empty while deferral is off. */
  listDeferredTools(): IToolSchema[] {
    if (this.resolveToolSearchMode() === 'off') return [];
    return this.getTools().filter(
      (schema) => isDeferredTool(schema) && !this.loadedDeferredTools.has(schema.name),
    );
  }

  /**
   * Mark deferred tools loaded for the rest of the session. Every name is resolved before any is
   * loaded, so an unknown entry — thrown naming it — loads nothing; a resident name is returned as
   * it is, already offered.
   */
  loadDeferredTools(names: readonly string[]): IToolSchema[] {
    this.ensureInitialized();
    const schemas = names.map((name) => {
      const schema = this.registry.get(name)?.schema;
      if (!schema) {
        throw new ToolExecutionError(
          `Tool "${name}" is not registered, so it cannot be loaded`,
          name,
        );
      }
      return schema;
    });
    for (const schema of schemas) {
      if (isDeferredTool(schema)) this.loadedDeferredTools.add(schema.name);
    }
    return schemas;
  }

  /**
   * Execute a tool with parameters
   */
  async executeTool(
    name: string,
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<TUniversalValue> {
    this.ensureInitialized();

    // Check if tool is allowed
    if (this.allowedTools && !this.allowedTools.includes(name)) {
      throw new ToolExecutionError(`Tool "${name}" is not in the allowed tools list`, name);
    }

    const tool = this.registry.get(name);
    if (!tool) {
      throw new ToolExecutionError(`Tool "${name}" is not registered`, name);
    }

    let result;
    try {
      result = await tool.execute(parameters, context);
    } catch (error) {
      // Re-wrap errors thrown by tools to ensure instanceof checks work
      // when tools are loaded from dist packages
      if (error instanceof Error) {
        throw new ToolExecutionError(error.message, name, error);
      }
      throw new ToolExecutionError(String(error), name);
    }

    if (!result.success) {
      throw new ToolExecutionError(result.error || 'Tool execution failed', name, undefined, {
        parameters: JSON.stringify(parameters),
        result: JSON.stringify(result),
      });
    }

    if (typeof result.data === 'undefined') {
      throw new ToolExecutionError('Tool execution succeeded but returned no data', name);
    }
    return result.data;
  }

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean {
    this.ensureInitialized();
    return this.registry.has(name);
  }

  /**
   * Set allowed tools for filtering
   */
  setAllowedTools(tools: string[]): void {
    this.ensureInitialized();
    this.allowedTools = [...tools];
    logger.debug(`Set allowed tools: ${tools.join(', ')}`);
  }

  /**
   * Get allowed tools
   */
  getAllowedTools(): string[] | undefined {
    this.ensureInitialized();
    return this.allowedTools ? [...this.allowedTools] : undefined;
  }

  /**
   * Get tool registry instance (for advanced operations)
   */
  getRegistry(): ToolRegistry {
    this.ensureInitialized();
    return this.registry;
  }

  /**
   * Get tool count
   */
  getToolCount(): number {
    this.ensureInitialized();
    return this.registry.size();
  }
}
