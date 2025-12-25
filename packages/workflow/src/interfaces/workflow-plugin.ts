// Workflow Plugin Interfaces
// Extensible plugin system for workflow customization

import type { IWorkflowNode } from './workflow-node.js';
import type { IWorkflowEdge } from './workflow-edge.js';
import type { IWorkflowSnapshot } from './workflow-builder.js';
import type { TLoggerData, TUniversalValue } from '@robota-sdk/agents';

export type TWorkflowPluginValue = TUniversalValue | Date | Error | TLoggerData;

/**
 * Plugin lifecycle hooks
 */
export type TPluginLifecycle =
    | 'beforeNodeCreate'
    | 'afterNodeCreate'
    | 'beforeNodeUpdate'
    | 'afterNodeUpdate'
    | 'beforeNodeDelete'
    | 'afterNodeDelete'
    | 'beforeEdgeCreate'
    | 'afterEdgeCreate'
    | 'beforeEdgeUpdate'
    | 'afterEdgeUpdate'
    | 'beforeEdgeDelete'
    | 'afterEdgeDelete'
    | 'beforeSnapshot'
    | 'afterSnapshot';

/**
 * Plugin configuration interface
 */
export interface IPluginConfig {
    enabled?: boolean;
    priority?: number;
    options?: Record<string, TWorkflowPluginValue | undefined>;
    dependencies?: string[]; // Other plugin names this plugin depends on
    conflicts?: string[]; // Plugin names that conflict with this plugin
}

/**
 * Plugin context for lifecycle hooks
 */
export interface IPluginContext {
    // Current workflow state
    nodes: Map<string, IWorkflowNode>;
    edges: Map<string, IWorkflowEdge>;

    // Plugin utilities
    createNode: (nodeData: Omit<IWorkflowNode, 'timestamp'>) => IWorkflowNode;
    createEdge: (edgeData: Omit<IWorkflowEdge, 'timestamp'>) => IWorkflowEdge;
    updateNode: (nodeId: string, updates: Partial<IWorkflowNode>) => IWorkflowNode | null;
    updateEdge: (edgeId: string, updates: Partial<IWorkflowEdge>) => IWorkflowEdge | null;

    // Metadata
    pluginName: string;
    hookName: TPluginLifecycle;
    timestamp: Date;

    // Logger
    logger: {
        debug: (message: string, ...args: TWorkflowPluginValue[]) => void;
        info: (message: string, ...args: TWorkflowPluginValue[]) => void;
        warn: (message: string, ...args: TWorkflowPluginValue[]) => void;
        error: (message: string, ...args: TWorkflowPluginValue[]) => void;
    };
}

/**
 * Hook handler function type
 */
export type TPluginHookHandler<TInput = TWorkflowPluginValue, TOutput = TWorkflowPluginValue> = (
    input: TInput,
    context: IPluginContext
) => Promise<TOutput> | TOutput;

/**
 * Core workflow plugin interface
 */
export interface IWorkflowPlugin {
    /**
     * Plugin identification
     */
    readonly name: string;
    readonly version: string;
    readonly description: string;

    /**
     * Plugin configuration
     */
    config: IPluginConfig;

    /**
     * Lifecycle hooks (all optional)
     */
    beforeNodeCreate?: TPluginHookHandler<IWorkflowNode, IWorkflowNode>;
    afterNodeCreate?: TPluginHookHandler<IWorkflowNode, void>;
    beforeNodeUpdate?: TPluginHookHandler<{ node: IWorkflowNode; updates: Partial<IWorkflowNode> }, Partial<IWorkflowNode>>;
    afterNodeUpdate?: TPluginHookHandler<{ oldNode: IWorkflowNode; newNode: IWorkflowNode }, void>;
    beforeNodeDelete?: TPluginHookHandler<IWorkflowNode, boolean>; // Return false to prevent deletion
    afterNodeDelete?: TPluginHookHandler<IWorkflowNode, void>;

    beforeEdgeCreate?: TPluginHookHandler<IWorkflowEdge, IWorkflowEdge>;
    afterEdgeCreate?: TPluginHookHandler<IWorkflowEdge, void>;
    beforeEdgeUpdate?: TPluginHookHandler<{ edge: IWorkflowEdge; updates: Partial<IWorkflowEdge> }, Partial<IWorkflowEdge>>;
    afterEdgeUpdate?: TPluginHookHandler<{ oldEdge: IWorkflowEdge; newEdge: IWorkflowEdge }, void>;
    beforeEdgeDelete?: TPluginHookHandler<IWorkflowEdge, boolean>; // Return false to prevent deletion
    afterEdgeDelete?: TPluginHookHandler<IWorkflowEdge, void>;

    beforeSnapshot?: TPluginHookHandler<IWorkflowSnapshot, IWorkflowSnapshot>;
    afterSnapshot?: TPluginHookHandler<IWorkflowSnapshot, void>;

    /**
     * Plugin lifecycle methods
     */
    initialize?: (context: IPluginContext) => Promise<void> | void;
    configure?: (config: IPluginConfig) => void;
    destroy?: () => Promise<void> | void;

    /**
     * Plugin capabilities
     */
    getCapabilities?: () => {
        providesNodes?: string[]; // Node types this plugin can create
        providesEdges?: string[]; // Edge types this plugin can create
        modifiesNodes?: string[]; // Node types this plugin modifies
        modifiesEdges?: string[]; // Edge types this plugin modifies
    };

    /**
     * Plugin health check
     */
    healthCheck?: () => Promise<{
        healthy: boolean;
        message?: string;
        details?: Record<string, TWorkflowPluginValue | undefined>;
    }>;
}

/**
 * Plugin validation result
 */
export interface IPluginValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    dependencies: {
        missing: string[];
        conflicts: string[];
    };
}

/**
 * Plugin manager interface
 */
export interface IPluginManager {
    /**
     * Register a plugin
     */
    register(plugin: IWorkflowPlugin): Promise<IPluginValidationResult>;

    /**
     * Unregister a plugin
     */
    unregister(pluginName: string): Promise<boolean>;

    /**
     * Get plugin by name
     */
    getPlugin(name: string): IWorkflowPlugin | undefined;

    /**
     * Get all registered plugins
     */
    getAllPlugins(): IWorkflowPlugin[];

    /**
     * Get enabled plugins
     */
    getEnabledPlugins(): IWorkflowPlugin[];

    /**
     * Enable/disable plugin
     */
    setPluginEnabled(name: string, enabled: boolean): boolean;

    /**
     * Configure plugin
     */
    configurePlugin(name: string, config: IPluginConfig): boolean;

    /**
     * Execute hook for all plugins
     */
    executeHook<TInput, TOutput>(
        hookName: TPluginLifecycle,
        input: TInput,
        context: IPluginContext
    ): Promise<TOutput>;

    /**
     * Validate all plugins
     */
    validateAllPlugins(): IPluginValidationResult[];

    /**
     * Get plugin execution order based on dependencies and priorities
     */
    getExecutionOrder(): IWorkflowPlugin[];

    /**
     * Plugin health check
     */
    healthCheck(): Promise<{
        [pluginName: string]: {
            healthy: boolean;
            message?: string;
            details?: Record<string, TWorkflowPluginValue | undefined>;
        };
    }>;

    /**
     * Clear all plugins
     */
    clear(): void;
}

/**
 * Plugin factory interface
 */
export interface IPluginFactory {
    /**
     * Create plugin instance
     */
    create(config?: IPluginConfig): IWorkflowPlugin;

    /**
     * Get plugin metadata
     */
    getMetadata(): {
        name: string;
        version: string;
        description: string;
        author?: string;
        homepage?: string;
        tags?: string[];
    };

    /**
     * Validate plugin configuration
     */
    validateConfig(config: IPluginConfig): {
        isValid: boolean;
        errors: string[];
    };
}

/**
 * Built-in plugin types for common use cases
 */
export interface IValidationPlugin extends IWorkflowPlugin {
    validateNode?: (node: IWorkflowNode) => { valid: boolean; errors: string[] };
    validateEdge?: (edge: IWorkflowEdge) => { valid: boolean; errors: string[] };
    validateWorkflow?: (snapshot: IWorkflowSnapshot) => { valid: boolean; errors: string[] };
}

export interface ITransformationPlugin extends IWorkflowPlugin {
    transformNode?: (node: IWorkflowNode) => IWorkflowNode;
    transformEdge?: (edge: IWorkflowEdge) => IWorkflowEdge;
    transformWorkflow?: (snapshot: IWorkflowSnapshot) => IWorkflowSnapshot;
}

export interface IAuditPlugin extends IWorkflowPlugin {
    auditLog?: {
        operation: string;
        target: string;
        timestamp: Date;
        metadata: Record<string, TWorkflowPluginValue | undefined>;
    }[];
    getAuditLog?: () => IAuditPlugin['auditLog'];
    clearAuditLog?: () => void;
}

/**
 * Plugin utility functions
 */
export class PluginUtils {
    /**
     * Resolve plugin dependencies
     */
    static resolveDependencies(plugins: IWorkflowPlugin[]): IWorkflowPlugin[] {
        const resolved: IWorkflowPlugin[] = [];
        const visiting = new Set<string>();
        const visited = new Set<string>();

        const visit = (plugin: IWorkflowPlugin) => {
            if (visited.has(plugin.name)) return;
            if (visiting.has(plugin.name)) {
                throw new Error(`Circular dependency detected involving plugin: ${plugin.name}`);
            }

            visiting.add(plugin.name);

            // Visit dependencies first
            const dependencies = plugin.config.dependencies || [];
            for (const depName of dependencies) {
                const depPlugin = plugins.find(p => p.name === depName);
                if (depPlugin) {
                    visit(depPlugin);
                }
            }

            visiting.delete(plugin.name);
            visited.add(plugin.name);
            resolved.push(plugin);
        };

        for (const plugin of plugins) {
            visit(plugin);
        }

        return resolved;
    }

    /**
     * Check for plugin conflicts
     */
    static checkConflicts(plugins: IWorkflowPlugin[]): string[] {
        const conflicts: string[] = [];
        const pluginMap = new Map(plugins.map(p => [p.name, p]));

        for (const plugin of plugins) {
            const conflictNames = plugin.config.conflicts || [];
            for (const conflictName of conflictNames) {
                if (pluginMap.has(conflictName)) {
                    conflicts.push(`Plugin ${plugin.name} conflicts with ${conflictName}`);
                }
            }
        }

        return conflicts;
    }
}
