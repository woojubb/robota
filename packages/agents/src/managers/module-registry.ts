import {
    BaseModule,
    BaseModuleOptions,
    ModuleExecutionContext,
    ModuleExecutionResult
} from '../abstracts/base-module';
import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import { ModuleTypeRegistry } from './module-type-registry';
import { Logger, createLogger } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';

/**
 * Module registration options
 */
export interface ModuleRegistrationOptions {
    /** Whether to initialize the module immediately */
    autoInitialize?: boolean;
    /** Custom initialization options */
    initOptions?: BaseModuleOptions;
    /** Whether to validate dependencies */
    validateDependencies?: boolean;
    /** Custom initialization timeout */
    initTimeout?: number;
}

/**
 * Module status information
 */
export interface ModuleStatus {
    name: string;
    type: string;
    enabled: boolean;
    initialized: boolean;
    hasEventEmitter: boolean;
    registrationTime: Date;
    initializationTime?: Date;
    lastActivity?: Date;
    dependencies: string[];
    dependents: string[];
}

/**
 * Module execution statistics
 */
export interface ModuleExecutionStats {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    lastExecutionTime?: Date;
    totalExecutionTime: number;
}

/**
 * Registry for managing module instances
 * Handles module lifecycle, dependencies, and execution coordination
 * 
 * Key features:
 * - Dependency-based initialization ordering
 * - Module lifecycle management (register, initialize, dispose)
 * - Event-driven communication through EventEmitter
 * - Module status tracking and statistics
 * - Error handling and recovery
 */
export class ModuleRegistry {
    private modules = new Map<string, BaseModule>();
    private moduleOptions = new Map<string, BaseModuleOptions>();
    private moduleStatuses = new Map<string, ModuleStatus>();
    private moduleStats = new Map<string, ModuleExecutionStats>();
    private registrationOrder: string[] = [];
    private initializationOrder: string[] = [];
    private typeRegistry: ModuleTypeRegistry;
    private eventEmitter: EventEmitterPlugin | undefined;
    private logger: Logger;
    private isDisposing = false;

    constructor(eventEmitter?: EventEmitterPlugin) {
        this.eventEmitter = eventEmitter;
        this.typeRegistry = ModuleTypeRegistry.getInstance();
        this.logger = createLogger('ModuleRegistry');

        this.logger.info('ModuleRegistry created', {
            hasEventEmitter: !!this.eventEmitter
        });
    }

    /**
     * Register a module instance
     */
    async registerModule(
        module: BaseModule,
        options: ModuleRegistrationOptions = {}
    ): Promise<void> {
        if (this.isDisposing) {
            throw new ConfigurationError('Cannot register modules during disposal');
        }

        // Validate module
        this.validateModule(module);

        // Check for name conflicts
        if (this.modules.has(module.name)) {
            throw new ConfigurationError(
                `Module with name '${module.name}' is already registered`,
                { moduleName: module.name }
            );
        }

        // Validate dependencies if requested
        if (options.validateDependencies !== false) {
            await this.validateModuleDependencies(module);
        }

        // Register the module
        this.modules.set(module.name, module);
        this.moduleOptions.set(module.name, options.initOptions || {});
        this.registrationOrder.push(module.name);

        // Create status tracking
        const moduleType = module.getModuleType();
        const status: ModuleStatus = {
            name: module.name,
            type: moduleType.type,
            enabled: module.isEnabled(),
            initialized: false,
            hasEventEmitter: !!this.eventEmitter,
            registrationTime: new Date(),
            dependencies: moduleType.dependencies || [],
            dependents: []
        };
        this.moduleStatuses.set(module.name, status);

        // Initialize execution statistics
        this.moduleStats.set(module.name, {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0
        });

        this.logger.info('Module registered', {
            name: module.name,
            type: moduleType.type,
            autoInitialize: options.autoInitialize
        });

        // Auto-initialize if requested
        if (options.autoInitialize) {
            await this.initializeModule(module.name, options.initTimeout);
        }

        // Emit registration event
        if (this.eventEmitter) {
            await this.eventEmitter.emit('module.registered', {
                data: {
                    moduleName: module.name,
                    moduleType: moduleType.type
                } as any
            });
        }
    }

    /**
     * Unregister a module
     */
    async unregisterModule(moduleName: string): Promise<boolean> {
        const module = this.modules.get(moduleName);
        if (!module) {
            return false;
        }

        // Check if other modules depend on this one
        const dependents = this.findDependentModules(moduleName);
        if (dependents.length > 0) {
            throw new ConfigurationError(
                `Cannot unregister module '${moduleName}' - it is required by: ${dependents.join(', ')}`,
                { moduleName, dependents }
            );
        }

        // Dispose the module if initialized
        if (module.isInitialized()) {
            await module.dispose();
        }

        // Remove from all tracking structures
        this.modules.delete(moduleName);
        this.moduleOptions.delete(moduleName);
        this.moduleStatuses.delete(moduleName);
        this.moduleStats.delete(moduleName);

        // Remove from order arrays
        const regIndex = this.registrationOrder.indexOf(moduleName);
        if (regIndex !== -1) {
            this.registrationOrder.splice(regIndex, 1);
        }

        const initIndex = this.initializationOrder.indexOf(moduleName);
        if (initIndex !== -1) {
            this.initializationOrder.splice(initIndex, 1);
        }

        this.logger.info('Module unregistered', { name: moduleName });

        // Emit unregistration event
        if (this.eventEmitter) {
            await this.eventEmitter.emit('module.unregistered', {
                data: {
                    moduleName
                } as any
            });
        }

        return true;
    }

    /**
     * Initialize a specific module
     */
    async initializeModule(moduleName: string, timeout?: number): Promise<void> {
        const module = this.modules.get(moduleName);
        if (!module) {
            throw new ConfigurationError(`Module '${moduleName}' not found`);
        }

        if (module.isInitialized()) {
            this.logger.debug('Module already initialized', { name: moduleName });
            return;
        }

        // Get initialization options
        const options = this.moduleOptions.get(moduleName);

        // Initialize with timeout if specified
        const initPromise = module.initialize(options, this.eventEmitter);

        if (timeout && timeout > 0) {
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Module '${moduleName}' initialization timed out after ${timeout}ms`));
                }, timeout);
            });

            await Promise.race([initPromise, timeoutPromise]);
        } else {
            await initPromise;
        }

        // Update status
        const status = this.moduleStatuses.get(moduleName);
        if (status) {
            status.initialized = true;
            status.initializationTime = new Date();
        }

        // Add to initialization order
        if (!this.initializationOrder.includes(moduleName)) {
            this.initializationOrder.push(moduleName);
        }

        this.logger.info('Module initialized', { name: moduleName });
    }

    /**
     * Initialize all registered modules in dependency order
     */
    async initializeAllModules(timeout?: number): Promise<void> {
        const moduleNames = Array.from(this.modules.keys());

        if (moduleNames.length === 0) {
            this.logger.debug('No modules to initialize');
            return;
        }

        // Get module types for dependency resolution
        const moduleTypes = moduleNames.map(name => {
            const module = this.modules.get(name)!;
            return module.getModuleType().type;
        });

        // Resolve dependencies
        const resolution = this.typeRegistry.resolveDependencies(moduleTypes);

        if (!resolution.resolved) {
            const errors: string[] = [];

            if (resolution.missingDependencies.length > 0) {
                errors.push(`Missing dependencies: ${resolution.missingDependencies.join(', ')}`);
            }

            if (resolution.circularDependencies.length > 0) {
                const cycles = resolution.circularDependencies.map(cycle => cycle.join(' -> ')).join('; ');
                errors.push(`Circular dependencies: ${cycles}`);
            }

            throw new ConfigurationError(
                `Cannot initialize modules: ${errors.join('; ')}`,
                {
                    missingDependencies: resolution.missingDependencies,
                    circularDependencies: resolution.circularDependencies
                }
            );
        }

        // Initialize modules in dependency order
        this.logger.info('Initializing modules in dependency order', {
            order: resolution.order,
            totalModules: moduleNames.length
        });

        for (const moduleType of resolution.order) {
            // Find module by type
            const moduleName = moduleNames.find(name => {
                const module = this.modules.get(name)!;
                return module.getModuleType().type === moduleType;
            });

            if (moduleName) {
                await this.initializeModule(moduleName, timeout);
            }
        }

        this.logger.info('All modules initialized successfully', {
            initializedCount: this.initializationOrder.length
        });
    }

    /**
     * Execute a module by name
     */
    async executeModule(moduleName: string, context: ModuleExecutionContext): Promise<ModuleExecutionResult> {
        const module = this.modules.get(moduleName);
        if (!module) {
            throw new ConfigurationError(`Module '${moduleName}' not found`);
        }

        if (!module.isInitialized()) {
            throw new ConfigurationError(`Module '${moduleName}' is not initialized`);
        }

        if (!module.isEnabled()) {
            throw new ConfigurationError(`Module '${moduleName}' is disabled`);
        }

        // Update statistics
        const stats = this.moduleStats.get(moduleName)!;
        const startTime = Date.now();

        try {
            const result = await module.execute(context);

            // Update success statistics
            const duration = Date.now() - startTime;
            stats.totalExecutions++;
            stats.successfulExecutions++;
            stats.totalExecutionTime += duration;
            stats.averageExecutionTime = stats.totalExecutionTime / stats.totalExecutions;
            stats.lastExecutionTime = new Date();

            // Update module status
            const status = this.moduleStatuses.get(moduleName);
            if (status) {
                status.lastActivity = new Date();
            }

            return result;

        } catch (error) {
            // Update error statistics
            const duration = Date.now() - startTime;
            stats.totalExecutions++;
            stats.failedExecutions++;
            stats.totalExecutionTime += duration;
            stats.averageExecutionTime = stats.totalExecutionTime / stats.totalExecutions;
            stats.lastExecutionTime = new Date();

            throw error;
        }
    }

    /**
     * Get a module by name
     */
    getModule<T extends BaseModule = BaseModule>(moduleName: string): T | null {
        const module = this.modules.get(moduleName);
        return module ? (module as T) : null;
    }

    /**
     * Get modules by type
     */
    getModulesByType<T extends BaseModule = BaseModule>(moduleType: string): T[] {
        const modules: T[] = [];

        for (const module of this.modules.values()) {
            if (module.getModuleType().type === moduleType) {
                modules.push(module as T);
            }
        }

        return modules;
    }

    /**
     * Get all registered modules
     */
    getAllModules(): BaseModule[] {
        return Array.from(this.modules.values());
    }

    /**
     * Get module names
     */
    getModuleNames(): string[] {
        return Array.from(this.modules.keys());
    }

    /**
     * Check if a module is registered
     */
    hasModule(moduleName: string): boolean {
        return this.modules.has(moduleName);
    }

    /**
     * Get module status
     */
    getModuleStatus(moduleName: string): ModuleStatus | null {
        return this.moduleStatuses.get(moduleName) || null;
    }

    /**
     * Get all module statuses
     */
    getAllModuleStatuses(): ModuleStatus[] {
        return Array.from(this.moduleStatuses.values());
    }

    /**
     * Get module execution statistics
     */
    getModuleStats(moduleName: string): ModuleExecutionStats | null {
        return this.moduleStats.get(moduleName) || null;
    }

    /**
     * Get all module execution statistics
     */
    getAllModuleStats(): Record<string, ModuleExecutionStats> {
        const stats: Record<string, ModuleExecutionStats> = {};
        for (const [name, moduleStats] of this.moduleStats.entries()) {
            stats[name] = { ...moduleStats };
        }
        return stats;
    }

    /**
     * Dispose all modules in reverse initialization order
     */
    async disposeAllModules(): Promise<void> {
        this.isDisposing = true;

        if (this.initializationOrder.length === 0) {
            this.logger.debug('No modules to dispose');
            return;
        }

        // Dispose in reverse initialization order
        const reverseOrder = [...this.initializationOrder].reverse();

        this.logger.info('Disposing modules in reverse order', {
            order: reverseOrder,
            totalModules: reverseOrder.length
        });

        for (const moduleName of reverseOrder) {
            const module = this.modules.get(moduleName);
            if (module && module.isInitialized()) {
                try {
                    await module.dispose();

                    // Update status
                    const status = this.moduleStatuses.get(moduleName);
                    if (status) {
                        status.initialized = false;
                    }

                    this.logger.debug('Module disposed', { name: moduleName });
                } catch (error) {
                    this.logger.error('Failed to dispose module', {
                        name: moduleName,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }

        // Clear initialization order
        this.initializationOrder = [];
        this.isDisposing = false;

        this.logger.info('All modules disposed');
    }

    /**
     * Clear all modules (for testing)
     */
    clearAllModules(): void {
        this.modules.clear();
        this.moduleOptions.clear();
        this.moduleStatuses.clear();
        this.moduleStats.clear();
        this.registrationOrder = [];
        this.initializationOrder = [];
        this.isDisposing = false;

        this.logger.info('All modules cleared');
    }

    /**
     * Get registry statistics
     */
    getRegistryStats(): {
        totalModules: number;
        initializedModules: number;
        enabledModules: number;
        modulesByType: Record<string, number>;
        totalExecutions: number;
        totalSuccessfulExecutions: number;
        totalFailedExecutions: number;
        averageExecutionTime: number;
    } {
        const modulesByType: Record<string, number> = {};
        let initializedModules = 0;
        let enabledModules = 0;
        let totalExecutions = 0;
        let totalSuccessfulExecutions = 0;
        let totalFailedExecutions = 0;
        let totalExecutionTime = 0;

        for (const module of this.modules.values()) {
            const moduleType = module.getModuleType().type;
            modulesByType[moduleType] = (modulesByType[moduleType] || 0) + 1;

            if (module.isInitialized()) {
                initializedModules++;
            }

            if (module.isEnabled()) {
                enabledModules++;
            }
        }

        for (const stats of this.moduleStats.values()) {
            totalExecutions += stats.totalExecutions;
            totalSuccessfulExecutions += stats.successfulExecutions;
            totalFailedExecutions += stats.failedExecutions;
            totalExecutionTime += stats.totalExecutionTime;
        }

        const averageExecutionTime = totalExecutions > 0
            ? totalExecutionTime / totalExecutions
            : 0;

        return {
            totalModules: this.modules.size,
            initializedModules,
            enabledModules,
            modulesByType,
            totalExecutions,
            totalSuccessfulExecutions,
            totalFailedExecutions,
            averageExecutionTime
        };
    }

    /**
     * Validate a module before registration
     */
    private validateModule(module: BaseModule): void {
        if (!module.name || module.name.trim() === '') {
            throw new ConfigurationError('Module name is required');
        }

        if (!module.version || module.version.trim() === '') {
            throw new ConfigurationError('Module version is required');
        }

        // Validate module type
        const moduleType = module.getModuleType();
        const validation = this.typeRegistry.validateTypeDescriptor(moduleType);

        if (!validation.valid) {
            throw new ConfigurationError(
                `Invalid module type: ${validation.errors.join(', ')}`,
                { moduleName: module.name, errors: validation.errors }
            );
        }

        // Log warnings if any
        if (validation.warnings.length > 0) {
            this.logger.warn('Module type validation warnings', {
                moduleName: module.name,
                warnings: validation.warnings
            });
        }
    }

    /**
     * Validate module dependencies
     */
    private async validateModuleDependencies(module: BaseModule): Promise<void> {
        const moduleType = module.getModuleType();

        if (!moduleType.dependencies || moduleType.dependencies.length === 0) {
            return;
        }

        // Check if dependency types are registered
        for (const depType of moduleType.dependencies) {
            if (!this.typeRegistry.hasType(depType)) {
                throw new ConfigurationError(
                    `Module '${module.name}' depends on unregistered type '${depType}'`,
                    { moduleName: module.name, dependencyType: depType }
                );
            }
        }

        // Check if dependency modules are available
        const availableTypes = new Set<string>();
        for (const registeredModule of this.modules.values()) {
            availableTypes.add(registeredModule.getModuleType().type);
        }

        const missingDependencies: string[] = [];
        for (const depType of moduleType.dependencies) {
            if (!availableTypes.has(depType)) {
                missingDependencies.push(depType);
            }
        }

        if (missingDependencies.length > 0) {
            this.logger.warn('Module has unmet dependencies', {
                moduleName: module.name,
                missingDependencies
            });
        }
    }

    /**
     * Find modules that depend on the given module
     */
    private findDependentModules(moduleName: string): string[] {
        const targetModule = this.modules.get(moduleName);
        if (!targetModule) {
            return [];
        }

        const targetType = targetModule.getModuleType().type;
        const dependents: string[] = [];

        for (const [name, module] of this.modules.entries()) {
            if (name === moduleName) continue;

            const moduleType = module.getModuleType();
            if (moduleType.dependencies?.includes(targetType)) {
                dependents.push(name);
            }
        }

        return dependents;
    }
} 