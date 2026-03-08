/**
 * Registry for managing module instances.
 *
 * Validation helpers live in ./module-registry-validation.ts.
 */
import type { IBaseModuleOptions, IModule, IModuleExecutionContext, IModuleExecutionResult } from '../abstracts/abstract-module';
import type { IEventEmitterPlugin } from '../plugins/event-emitter/types';
import { ModuleDescriptorRegistry } from './module-type-registry';
import { createLogger, type ILogger } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';
import { validateModule, validateModuleDependencies, findDependentModules, buildRegistryStats } from './module-registry-validation';
import type { IModuleExecutionStats, IModuleRegistryStats } from './module-registry-validation';

export type { IModuleExecutionStats };

export const MODULE_REGISTRY_EVENTS = {
    REGISTERED: 'module.registered',
    UNREGISTERED: 'module.unregistered'
} as const;

export interface IModuleRegistrationOptions {
    autoInitialize?: boolean;
    initOptions?: IBaseModuleOptions;
    validateDependencies?: boolean;
    initTimeout?: number;
}

export interface IModuleStatus {
    name: string; type: string; enabled: boolean; initialized: boolean;
    hasEventEmitter: boolean; registrationTime: Date; initializationTime?: Date;
    lastActivity?: Date; dependencies: string[]; dependents: string[];
}

export class ModuleRegistry {
    private modules = new Map<string, IModule>();
    private moduleOptions = new Map<string, IBaseModuleOptions>();
    private moduleStatuses = new Map<string, IModuleStatus>();
    private moduleStats = new Map<string, IModuleExecutionStats>();
    private registrationOrder: string[] = [];
    private initializationOrder: string[] = [];
    private typeRegistry: ModuleDescriptorRegistry;
    private eventEmitter: IEventEmitterPlugin | undefined;
    private logger: ILogger;
    private isDisposing = false;

    constructor(eventEmitter?: IEventEmitterPlugin, typeRegistry?: ModuleDescriptorRegistry) {
        this.eventEmitter = eventEmitter;
        this.typeRegistry = typeRegistry ?? new ModuleDescriptorRegistry();
        this.logger = createLogger('ModuleRegistry');
    }

    async registerModule(module: IModule, options: IModuleRegistrationOptions = {}): Promise<void> {
        if (this.isDisposing) throw new ConfigurationError('Cannot register modules during disposal');
        validateModule(module, this.typeRegistry, this.logger);
        if (this.modules.has(module.name)) throw new ConfigurationError(`Module with name '${module.name}' is already registered`, { moduleName: module.name });
        if (options.validateDependencies !== false) await validateModuleDependencies(module, this.typeRegistry, this.modules, this.logger);

        this.modules.set(module.name, module);
        this.moduleOptions.set(module.name, options.initOptions || {});
        this.registrationOrder.push(module.name);
        const moduleType = module.getModuleType();
        this.moduleStatuses.set(module.name, { name: module.name, type: moduleType.type, enabled: module.isEnabled(), initialized: false, hasEventEmitter: !!this.eventEmitter, registrationTime: new Date(), dependencies: moduleType.dependencies || [], dependents: [] });
        this.moduleStats.set(module.name, { totalExecutions: 0, successfulExecutions: 0, failedExecutions: 0, averageExecutionTime: 0, totalExecutionTime: 0 });

        if (options.autoInitialize) await this.initializeModule(module.name, options.initTimeout);
        if (this.eventEmitter) await this.eventEmitter.emit(MODULE_REGISTRY_EVENTS.REGISTERED, { data: { moduleName: module.name, moduleType: moduleType.type }, timestamp: new Date() });
    }

    async unregisterModule(moduleName: string): Promise<boolean> {
        const module = this.modules.get(moduleName);
        if (!module) return false;
        const dependents = findDependentModules(moduleName, this.modules);
        if (dependents.length > 0) throw new ConfigurationError(`Cannot unregister module '${moduleName}' - it is required by: ${dependents.join(', ')}`, { moduleName, dependents });
        if (module.isInitialized() && module.dispose) await module.dispose();
        this.modules.delete(moduleName); this.moduleOptions.delete(moduleName); this.moduleStatuses.delete(moduleName); this.moduleStats.delete(moduleName);
        const ri = this.registrationOrder.indexOf(moduleName); if (ri !== -1) this.registrationOrder.splice(ri, 1);
        const ii = this.initializationOrder.indexOf(moduleName); if (ii !== -1) this.initializationOrder.splice(ii, 1);
        if (this.eventEmitter) await this.eventEmitter.emit(MODULE_REGISTRY_EVENTS.UNREGISTERED, { data: { moduleName }, timestamp: new Date() });
        return true;
    }

    async initializeModule(moduleName: string, timeout?: number): Promise<void> {
        const module = this.modules.get(moduleName);
        if (!module) throw new ConfigurationError(`Module '${moduleName}' not found`);
        if (module.isInitialized()) return;
        const options = this.moduleOptions.get(moduleName);
        const initPromise = module.initialize(options, this.eventEmitter);
        if (timeout && timeout > 0) {
            let timerId: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<never>((_, reject) => { timerId = setTimeout(() => { reject(new Error(`Module '${moduleName}' initialization timed out after ${timeout}ms`)); }, timeout); });
            await Promise.race([initPromise.then(result => { clearTimeout(timerId); return result; }), timeoutPromise]);
        } else { await initPromise; }
        const status = this.moduleStatuses.get(moduleName);
        if (status) { status.initialized = true; status.initializationTime = new Date(); }
        if (!this.initializationOrder.includes(moduleName)) this.initializationOrder.push(moduleName);
    }

    async initializeAllModules(timeout?: number): Promise<void> {
        const moduleNames = Array.from(this.modules.keys());
        if (moduleNames.length === 0) return;
        const moduleTypes = moduleNames.map(name => this.modules.get(name)!.getModuleType().type);
        const resolution = this.typeRegistry.resolveDependencies(moduleTypes);
        if (!resolution.resolved) {
            const errors: string[] = [];
            if (resolution.missingDependencies.length > 0) errors.push(`Missing dependencies: ${resolution.missingDependencies.join(', ')}`);
            if (resolution.circularDependencies.length > 0) errors.push(`Circular dependencies: ${resolution.circularDependencies.map(c => c.join(' -> ')).join('; ')}`);
            throw new ConfigurationError(`Cannot initialize modules: ${errors.join('; ')}`, { missingDependencies: resolution.missingDependencies, circularDependencies: resolution.circularDependencies.map(c => c.join(' -> ')) });
        }
        for (const moduleType of resolution.order) {
            const mn = moduleNames.find(name => this.modules.get(name)!.getModuleType().type === moduleType);
            if (mn) await this.initializeModule(mn, timeout);
        }
    }

    async executeModule(moduleName: string, context: IModuleExecutionContext): Promise<IModuleExecutionResult> {
        const module = this.modules.get(moduleName);
        if (!module) throw new ConfigurationError(`Module '${moduleName}' not found`);
        if (!module.isInitialized()) throw new ConfigurationError(`Module '${moduleName}' is not initialized`);
        if (!module.isEnabled()) throw new ConfigurationError(`Module '${moduleName}' is disabled`);
        const stats = this.moduleStats.get(moduleName)!;
        const startTime = Date.now();
        try {
            if (!module.execute) throw new ConfigurationError(`Module '${moduleName}' does not support execute()`);
            const result = await module.execute(context);
            const duration = Date.now() - startTime;
            stats.totalExecutions++; stats.successfulExecutions++; stats.totalExecutionTime += duration;
            stats.averageExecutionTime = stats.totalExecutionTime / stats.totalExecutions; stats.lastExecutionTime = new Date();
            const status = this.moduleStatuses.get(moduleName); if (status) status.lastActivity = new Date();
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            stats.totalExecutions++; stats.failedExecutions++; stats.totalExecutionTime += duration;
            stats.averageExecutionTime = stats.totalExecutionTime / stats.totalExecutions; stats.lastExecutionTime = new Date();
            throw error;
        }
    }

    getModule(moduleName: string): IModule | undefined { return this.modules.get(moduleName); }
    getModulesByType(moduleType: string): IModule[] { return Array.from(this.modules.values()).filter(m => m.getModuleType().type === moduleType); }
    getAllModules(): IModule[] { return Array.from(this.modules.values()); }
    getModuleNames(): string[] { return Array.from(this.modules.keys()); }
    hasModule(moduleName: string): boolean { return this.modules.has(moduleName); }
    getModuleStatus(moduleName: string): IModuleStatus | undefined { return this.moduleStatuses.get(moduleName); }
    getAllModuleStatuses(): IModuleStatus[] { return Array.from(this.moduleStatuses.values()); }
    getModuleStats(moduleName: string): IModuleExecutionStats | undefined { return this.moduleStats.get(moduleName); }
    getAllModuleStats(): Record<string, IModuleExecutionStats> { const s: Record<string, IModuleExecutionStats> = {}; for (const [n, ms] of this.moduleStats.entries()) s[n] = { ...ms }; return s; }

    async disposeAllModules(): Promise<void> {
        this.isDisposing = true;
        const reverseOrder = [...this.initializationOrder].reverse();
        for (const moduleName of reverseOrder) {
            const module = this.modules.get(moduleName);
            if (module && module.isInitialized()) {
                try { if (module.dispose) await module.dispose(); const s = this.moduleStatuses.get(moduleName); if (s) s.initialized = false; }
                catch (error) { this.logger.error('Failed to dispose module', { name: moduleName, error: error instanceof Error ? error.message : String(error) }); }
            }
        }
        this.initializationOrder = []; this.isDisposing = false;
    }

    clearAllModules(): void {
        this.modules.clear(); this.moduleOptions.clear(); this.moduleStatuses.clear(); this.moduleStats.clear();
        this.registrationOrder = []; this.initializationOrder = []; this.isDisposing = false;
    }

    getRegistryStats(): IModuleRegistryStats { return buildRegistryStats(this.modules, this.moduleStats); }
}
