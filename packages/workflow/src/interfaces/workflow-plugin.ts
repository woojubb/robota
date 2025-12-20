// Workflow Plugin Interfaces
// Extensible plugin system for workflow customization

import type { WorkflowNode } from './workflow-node.js';
import type { WorkflowEdge } from './workflow-edge.js';
import type { WorkflowSnapshot } from './workflow-builder.js';
import type { LoggerData, UniversalValue } from '@robota-sdk/agents';

type WorkflowPluginValue = UniversalValue | Date | Error | LoggerData;

/**
 * Plugin lifecycle hooks
 */
export type PluginLifecycle =
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
export interface PluginConfig {
    enabled?: boolean;
    priority?: number;
    options?: Record<string, WorkflowPluginValue | undefined>;
    dependencies?: string[]; // Other plugin names this plugin depends on
    conflicts?: string[]; // Plugin names that conflict with this plugin
}

/**
 * Plugin context for lifecycle hooks
 */
export interface PluginContext {
    // Current workflow state
    nodes: Map<string, WorkflowNode>;
    edges: Map<string, WorkflowEdge>;

    // Plugin utilities
    createNode: (nodeData: Omit<WorkflowNode, 'timestamp'>) => WorkflowNode;
    createEdge: (edgeData: Omit<WorkflowEdge, 'timestamp'>) => WorkflowEdge;
    updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => WorkflowNode | null;
    updateEdge: (edgeId: string, updates: Partial<WorkflowEdge>) => WorkflowEdge | null;

    // Metadata
    pluginName: string;
    hookName: PluginLifecycle;
    timestamp: Date;

    // Logger
    logger: {
        debug: (message: string, ...args: WorkflowPluginValue[]) => void;
        info: (message: string, ...args: WorkflowPluginValue[]) => void;
        warn: (message: string, ...args: WorkflowPluginValue[]) => void;
        error: (message: string, ...args: WorkflowPluginValue[]) => void;
    };
}

/**
 * Hook handler function type
 */
export type PluginHookHandler<TInput = WorkflowPluginValue, TOutput = WorkflowPluginValue> = (
    input: TInput,
    context: PluginContext
) => Promise<TOutput> | TOutput;

/**
 * Core workflow plugin interface
 */
export interface WorkflowPlugin {
    /**
     * Plugin identification
     */
    readonly name: string;
    readonly version: string;
    readonly description: string;

    /**
     * Plugin configuration
     */
    config: PluginConfig;

    /**
     * Lifecycle hooks (all optional)
     */
    beforeNodeCreate?: PluginHookHandler<WorkflowNode, WorkflowNode>;
    afterNodeCreate?: PluginHookHandler<WorkflowNode, void>;
    beforeNodeUpdate?: PluginHookHandler<{ node: WorkflowNode; updates: Partial<WorkflowNode> }, Partial<WorkflowNode>>;
    afterNodeUpdate?: PluginHookHandler<{ oldNode: WorkflowNode; newNode: WorkflowNode }, void>;
    beforeNodeDelete?: PluginHookHandler<WorkflowNode, boolean>; // Return false to prevent deletion
    afterNodeDelete?: PluginHookHandler<WorkflowNode, void>;

    beforeEdgeCreate?: PluginHookHandler<WorkflowEdge, WorkflowEdge>;
    afterEdgeCreate?: PluginHookHandler<WorkflowEdge, void>;
    beforeEdgeUpdate?: PluginHookHandler<{ edge: WorkflowEdge; updates: Partial<WorkflowEdge> }, Partial<WorkflowEdge>>;
    afterEdgeUpdate?: PluginHookHandler<{ oldEdge: WorkflowEdge; newEdge: WorkflowEdge }, void>;
    beforeEdgeDelete?: PluginHookHandler<WorkflowEdge, boolean>; // Return false to prevent deletion
    afterEdgeDelete?: PluginHookHandler<WorkflowEdge, void>;

    beforeSnapshot?: PluginHookHandler<WorkflowSnapshot, WorkflowSnapshot>;
    afterSnapshot?: PluginHookHandler<WorkflowSnapshot, void>;

    /**
     * Plugin lifecycle methods
     */
    initialize?: (context: PluginContext) => Promise<void> | void;
    configure?: (config: PluginConfig) => void;
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
        details?: Record<string, WorkflowPluginValue | undefined>;
    }>;
}

/**
 * Plugin validation result
 */
export interface PluginValidationResult {
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
export interface PluginManager {
    /**
     * Register a plugin
     */
    register(plugin: WorkflowPlugin): Promise<PluginValidationResult>;

    /**
     * Unregister a plugin
     */
    unregister(pluginName: string): Promise<boolean>;

    /**
     * Get plugin by name
     */
    getPlugin(name: string): WorkflowPlugin | undefined;

    /**
     * Get all registered plugins
     */
    getAllPlugins(): WorkflowPlugin[];

    /**
     * Get enabled plugins
     */
    getEnabledPlugins(): WorkflowPlugin[];

    /**
     * Enable/disable plugin
     */
    setPluginEnabled(name: string, enabled: boolean): boolean;

    /**
     * Configure plugin
     */
    configurePlugin(name: string, config: PluginConfig): boolean;

    /**
     * Execute hook for all plugins
     */
    executeHook<TInput, TOutput>(
        hookName: PluginLifecycle,
        input: TInput,
        context: PluginContext
    ): Promise<TOutput>;

    /**
     * Validate all plugins
     */
    validateAllPlugins(): PluginValidationResult[];

    /**
     * Get plugin execution order based on dependencies and priorities
     */
    getExecutionOrder(): WorkflowPlugin[];

    /**
     * Plugin health check
     */
    healthCheck(): Promise<{
        [pluginName: string]: {
            healthy: boolean;
            message?: string;
            details?: Record<string, WorkflowPluginValue | undefined>;
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
export interface PluginFactory {
    /**
     * Create plugin instance
     */
    create(config?: PluginConfig): WorkflowPlugin;

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
    validateConfig(config: PluginConfig): {
        isValid: boolean;
        errors: string[];
    };
}

/**
 * Built-in plugin types for common use cases
 */
export interface ValidationPlugin extends WorkflowPlugin {
    validateNode?: (node: WorkflowNode) => { valid: boolean; errors: string[] };
    validateEdge?: (edge: WorkflowEdge) => { valid: boolean; errors: string[] };
    validateWorkflow?: (snapshot: WorkflowSnapshot) => { valid: boolean; errors: string[] };
}

export interface TransformationPlugin extends WorkflowPlugin {
    transformNode?: (node: WorkflowNode) => WorkflowNode;
    transformEdge?: (edge: WorkflowEdge) => WorkflowEdge;
    transformWorkflow?: (snapshot: WorkflowSnapshot) => WorkflowSnapshot;
}

export interface AuditPlugin extends WorkflowPlugin {
    auditLog?: {
        operation: string;
        target: string;
        timestamp: Date;
        metadata: Record<string, WorkflowPluginValue | undefined>;
    }[];
    getAuditLog?: () => AuditPlugin['auditLog'];
    clearAuditLog?: () => void;
}

/**
 * Plugin utility functions
 */
export class PluginUtils {
    /**
     * Resolve plugin dependencies
     */
    static resolveDependencies(plugins: WorkflowPlugin[]): WorkflowPlugin[] {
        const resolved: WorkflowPlugin[] = [];
        const visiting = new Set<string>();
        const visited = new Set<string>();

        const visit = (plugin: WorkflowPlugin) => {
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
    static checkConflicts(plugins: WorkflowPlugin[]): string[] {
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
