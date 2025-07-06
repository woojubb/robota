import { BaseManager } from '../abstracts/base-manager';
import { BasePlugin } from '../abstracts/base-plugin';
import { Logger, createLogger } from '../utils/logger';
import { PluginError, ConfigurationError } from '../utils/errors';

/**
 * Plugin lifecycle events
 */
export interface PluginLifecycleEvents {
    beforeInitialize?: (plugin: BasePlugin) => Promise<void> | void;
    afterInitialize?: (plugin: BasePlugin) => Promise<void> | void;
    beforeDestroy?: (plugin: BasePlugin) => Promise<void> | void;
    afterDestroy?: (plugin: BasePlugin) => Promise<void> | void;
    onError?: (plugin: BasePlugin, error: Error) => Promise<void> | void;
}

/**
 * Plugin dependency definition
 */
export interface PluginDependency {
    name: string;
    required: boolean;
    minVersion?: string;
}

/**
 * Plugin registration options
 */
export interface PluginRegistrationOptions {
    dependencies?: PluginDependency[];
    priority?: number; // Higher number = higher priority
    autoInitialize?: boolean;
}

/**
 * Plugin status information
 */
export interface PluginStatus {
    name: string;
    version?: string;
    enabled: boolean;
    initialized: boolean;
    dependencies: string[];
    priority: number;
}

/**
 * Plugins manager interface
 */
export interface PluginsManagerInterface {
    /**
     * Register a plugin with optional configuration
     */
    register(plugin: BasePlugin, options?: PluginRegistrationOptions): Promise<void>;

    /**
     * Unregister a plugin by name
     */
    unregister(pluginName: string): Promise<boolean>;

    /**
     * Initialize all registered plugins in dependency order
     */
    initializeAll(): Promise<void>;

    /**
     * Destroy all plugins in reverse dependency order
     */
    destroyAll(): Promise<void>;

    /**
     * Get plugin by name
     */
    getPlugin<T extends BasePlugin = BasePlugin>(name: string): T | null;

    /**
     * Get all registered plugins
     */
    getPlugins(): BasePlugin[];

    /**
     * Get plugin names
     */
    getPluginNames(): string[];

    /**
     * Check if plugin is registered
     */
    hasPlugin(name: string): boolean;

    /**
     * Get plugin status
     */
    getPluginStatus(name: string): PluginStatus | null;

    /**
     * Get all plugin statuses
     */
    getAllPluginStatuses(): PluginStatus[];
}

/**
 * Plugins class for managing plugin lifecycle and dependencies
 * Instance-based for isolation
 */
export class Plugins extends BaseManager implements PluginsManagerInterface {
    private plugins = new Map<string, BasePlugin>();
    private pluginOptions = new Map<string, PluginRegistrationOptions>();
    private initializationOrder: string[] = [];
    private lifecycleEvents: PluginLifecycleEvents;
    private logger: Logger;

    constructor(lifecycleEvents: PluginLifecycleEvents = {}) {
        super();
        this.lifecycleEvents = lifecycleEvents;
        this.logger = createLogger('Plugins');
    }

    /**
     * Actual initialization logic - required by BaseManager
     */
    protected async doInitialize(): Promise<void> {
        this.logger.debug('Plugins manager initializing');
        // No specific initialization needed for the manager itself
    }

    /**
     * Actual disposal logic - required by BaseManager
     */
    protected async doDispose(): Promise<void> {
        this.logger.debug('Plugins manager disposing');
        await this.destroyAll();
        this.plugins.clear();
        this.pluginOptions.clear();
        this.initializationOrder = [];
    }

    /**
     * Initialize the plugin manager
     */
    override async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.logger.debug('Initializing Plugins manager');
        this.initialized = true;
        this.logger.debug('Plugins manager initialized');
    }

    /**
     * Register a plugin with optional configuration
     */
    async register(plugin: BasePlugin, options: PluginRegistrationOptions = {}): Promise<void> {
        const pluginName = plugin.name;

        if (this.plugins.has(pluginName)) {
            this.logger.warn(`Plugin "${pluginName}" is already registered, overriding`, {
                pluginName,
                existingVersion: this.plugins.get(pluginName)?.version,
                newVersion: plugin.version
            });

            // Unregister existing plugin first
            await this.unregister(pluginName);
        }

        // Validate dependencies
        if (options.dependencies) {
            await this.validateDependencies(options.dependencies);
        }

        // Store plugin and options
        this.plugins.set(pluginName, plugin);
        this.pluginOptions.set(pluginName, {
            dependencies: options.dependencies || [],
            priority: options.priority || 0,
            autoInitialize: options.autoInitialize ?? true,
        });

        this.logger.info(`Plugin "${pluginName}" registered`, {
            version: plugin.version,
            priority: options.priority || 0,
            dependencies: options.dependencies?.length || 0,
            autoInitialize: options.autoInitialize ?? true,
        });

        // Auto-initialize if requested
        if (options.autoInitialize !== false) {
            await this.initializePlugin(pluginName);
        }
    }

    /**
     * Unregister a plugin by name
     */
    async unregister(pluginName: string): Promise<boolean> {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            this.logger.warn(`Attempted to unregister non-existent plugin "${pluginName}"`);
            return false;
        }

        try {
            // Destroy plugin if initialized
            const status = plugin.getStatus();
            if (status.initialized) {
                await this.destroyPlugin(pluginName);
            }

            // Remove from collections
            this.plugins.delete(pluginName);
            this.pluginOptions.delete(pluginName);
            this.initializationOrder = this.initializationOrder.filter(name => name !== pluginName);

            this.logger.info(`Plugin "${pluginName}" unregistered successfully`);
            return true;

        } catch (error) {
            this.logger.error(`Failed to unregister plugin "${pluginName}"`, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw new PluginError(`Failed to unregister plugin: ${error instanceof Error ? error.message : String(error)}`, pluginName);
        }
    }

    /**
     * Initialize all registered plugins in dependency order
     */
    async initializeAll(): Promise<void> {
        const pluginNames = Array.from(this.plugins.keys());
        this.initializationOrder = this.resolveDependencyOrder(pluginNames);

        this.logger.debug('Initializing all plugins', {
            totalPlugins: pluginNames.length,
            initializationOrder: this.initializationOrder,
        });

        for (const pluginName of this.initializationOrder) {
            await this.initializePlugin(pluginName);
        }

        this.logger.info('All plugins initialized successfully', {
            totalPlugins: this.initializationOrder.length,
        });
    }

    /**
     * Destroy all plugins in reverse dependency order
     */
    async destroyAll(): Promise<void> {
        const destroyOrder = [...this.initializationOrder].reverse();

        this.logger.debug('Destroying all plugins', {
            totalPlugins: destroyOrder.length,
            destroyOrder,
        });

        for (const pluginName of destroyOrder) {
            await this.destroyPlugin(pluginName);
        }

        this.initializationOrder = [];
        this.logger.info('All plugins destroyed successfully');
    }

    /**
     * Get plugin by name with type safety
     */
    getPlugin<T extends BasePlugin = BasePlugin>(name: string): T | null {
        const plugin = this.plugins.get(name);
        return plugin ? (plugin as T) : null;
    }

    /**
     * Get all registered plugins
     */
    getPlugins(): BasePlugin[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Get plugin names
     */
    getPluginNames(): string[] {
        return Array.from(this.plugins.keys());
    }

    /**
     * Check if plugin is registered
     */
    hasPlugin(name: string): boolean {
        return this.plugins.has(name);
    }

    /**
     * Get plugin status information
     */
    getPluginStatus(name: string): PluginStatus | null {
        const plugin = this.plugins.get(name);
        const options = this.pluginOptions.get(name);

        if (!plugin || !options) {
            return null;
        }

        const status = plugin.getStatus();
        return {
            name: status.name,
            version: status.version,
            enabled: status.enabled,
            initialized: status.initialized,
            dependencies: options.dependencies?.map(dep => dep.name) || [],
            priority: options.priority || 0,
        };
    }

    /**
     * Get all plugin statuses
     */
    getAllPluginStatuses(): PluginStatus[] {
        return Array.from(this.plugins.keys())
            .map(name => this.getPluginStatus(name))
            .filter((status): status is PluginStatus => status !== null);
    }

    // ================================
    // Private helper methods
    // ================================

    /**
     * Initialize a single plugin
     */
    private async initializePlugin(pluginName: string): Promise<void> {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            throw new PluginError(`Plugin "${pluginName}" not found`, pluginName);
        }

        const status = plugin.getStatus();
        if (status.initialized) {
            this.logger.debug(`Plugin "${pluginName}" already initialized`);
            return;
        }

        try {
            // Call before initialize lifecycle event
            if (this.lifecycleEvents.beforeInitialize) {
                await this.lifecycleEvents.beforeInitialize(plugin);
            }

            // Initialize the plugin
            const startTime = Date.now();
            await plugin.initialize();
            const duration = Date.now() - startTime;

            this.logger.info(`Plugin "${pluginName}" initialized successfully`, {
                duration,
                version: plugin.version,
            });

            // Call after initialize lifecycle event
            if (this.lifecycleEvents.afterInitialize) {
                await this.lifecycleEvents.afterInitialize(plugin);
            }

        } catch (error) {
            this.logger.error(`Failed to initialize plugin "${pluginName}"`, {
                error: error instanceof Error ? error.message : String(error),
            });

            // Call error lifecycle event
            if (this.lifecycleEvents.onError) {
                await this.lifecycleEvents.onError(plugin, error as Error);
            }

            throw new PluginError(`Failed to initialize plugin: ${error instanceof Error ? error.message : String(error)}`, pluginName);
        }
    }

    /**
     * Destroy a single plugin
     */
    private async destroyPlugin(pluginName: string): Promise<void> {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            return;
        }

        const status = plugin.getStatus();
        if (!status.initialized) {
            this.logger.debug(`Plugin "${pluginName}" not initialized, skipping destroy`);
            return;
        }

        try {
            // Call before destroy lifecycle event
            if (this.lifecycleEvents.beforeDestroy) {
                await this.lifecycleEvents.beforeDestroy(plugin);
            }

            // Destroy the plugin
            await plugin.dispose();

            this.logger.info(`Plugin "${pluginName}" destroyed successfully`);

            // Call after destroy lifecycle event
            if (this.lifecycleEvents.afterDestroy) {
                await this.lifecycleEvents.afterDestroy(plugin);
            }

        } catch (error) {
            this.logger.error(`Failed to destroy plugin "${pluginName}"`, {
                error: error instanceof Error ? error.message : String(error),
            });

            // Call error lifecycle event
            if (this.lifecycleEvents.onError) {
                await this.lifecycleEvents.onError(plugin, error as Error);
            }

            throw new PluginError(`Failed to destroy plugin: ${error instanceof Error ? error.message : String(error)}`, pluginName);
        }
    }

    /**
     * Validate plugin dependencies
     */
    private async validateDependencies(dependencies: PluginDependency[]): Promise<void> {
        for (const dep of dependencies) {
            if (dep.required && !this.plugins.has(dep.name)) {
                throw new ConfigurationError(`Required dependency "${dep.name}" is not registered`);
            }

            // Version checking could be implemented here if needed
            if (dep.minVersion) {
                const dependencyPlugin = this.plugins.get(dep.name);
                if (dependencyPlugin && dependencyPlugin.version) {
                    // Simple version comparison (could be enhanced with semver)
                    if (dependencyPlugin.version < dep.minVersion) {
                        throw new ConfigurationError(
                            `Dependency "${dep.name}" version ${dependencyPlugin.version} is less than required ${dep.minVersion}`
                        );
                    }
                }
            }
        }
    }

    /**
     * Resolve dependency order for initialization
     */
    private resolveDependencyOrder(pluginNames: string[]): string[] {
        const resolved: string[] = [];
        const visiting = new Set<string>();
        const visited = new Set<string>();

        const visit = (pluginName: string) => {
            if (visited.has(pluginName)) {
                return;
            }

            if (visiting.has(pluginName)) {
                throw new ConfigurationError(`Circular dependency detected involving plugin "${pluginName}"`);
            }

            visiting.add(pluginName);

            // Visit dependencies first
            const options = this.pluginOptions.get(pluginName);
            if (options?.dependencies) {
                for (const dep of options.dependencies) {
                    if (pluginNames.includes(dep.name)) {
                        visit(dep.name);
                    }
                }
            }

            visiting.delete(pluginName);
            visited.add(pluginName);
            resolved.push(pluginName);
        };

        // Sort by priority first, then resolve dependencies
        const sortedPlugins = pluginNames.sort((a, b) => {
            const priorityA = this.pluginOptions.get(a)?.priority || 0;
            const priorityB = this.pluginOptions.get(b)?.priority || 0;
            return priorityB - priorityA; // Higher priority first
        });

        for (const pluginName of sortedPlugins) {
            visit(pluginName);
        }

        return resolved;
    }
} 