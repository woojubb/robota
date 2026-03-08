/**
 * Module validation helpers for ModuleRegistry.
 *
 * Extracted from module-registry.ts to keep each file under 300 lines.
 * @internal
 */
import type { IModule } from '../abstracts/abstract-module';
import type { ModuleDescriptorRegistry } from './module-type-registry';
import { ConfigurationError } from '../utils/errors';
import type { ILogger } from '../utils/logger';

/** Validate a module before registration. @internal */
export function validateModule(module: IModule, typeRegistry: ModuleDescriptorRegistry, logger: ILogger): void {
    if (!module.name || module.name.trim() === '') {
        throw new ConfigurationError('Module name is required');
    }
    if (!module.version || module.version.trim() === '') {
        throw new ConfigurationError('Module version is required');
    }
    const moduleType = module.getModuleType();
    const validation = typeRegistry.validateTypeDescriptor(moduleType);
    if (!validation.valid) {
        throw new ConfigurationError(`Invalid module type: ${validation.errors.join(', ')}`, { moduleName: module.name, errors: validation.errors });
    }
    if (validation.warnings.length > 0) {
        logger.warn('Module type validation warnings', { moduleName: module.name, warnings: validation.warnings });
    }
}

/** Validate module dependencies against the type registry and registered modules. @internal */
export async function validateModuleDependencies(
    module: IModule,
    typeRegistry: ModuleDescriptorRegistry,
    registeredModules: Map<string, IModule>,
    logger: ILogger
): Promise<void> {
    const moduleType = module.getModuleType();
    if (!moduleType.dependencies || moduleType.dependencies.length === 0) return;

    for (const depType of moduleType.dependencies) {
        if (!typeRegistry.hasType(depType)) {
            throw new ConfigurationError(`Module '${module.name}' depends on unregistered type '${depType}'`, { moduleName: module.name, dependencyType: depType });
        }
    }

    const availableTypes = new Set<string>();
    for (const registeredModule of registeredModules.values()) {
        availableTypes.add(registeredModule.getModuleType().type);
    }
    const missing: string[] = [];
    for (const depType of moduleType.dependencies) {
        if (!availableTypes.has(depType)) missing.push(depType);
    }
    if (missing.length > 0) {
        logger.warn('Module has unmet dependencies', { moduleName: module.name, missingDependencies: missing });
    }
}

/** Find modules that depend on the given module. @internal */
export function findDependentModules(moduleName: string, modules: Map<string, IModule>): string[] {
    const targetModule = modules.get(moduleName);
    if (!targetModule) return [];
    const targetType = targetModule.getModuleType().type;
    const dependents: string[] = [];
    for (const [name, module] of modules.entries()) {
        if (name === moduleName) continue;
        if (module.getModuleType().dependencies?.includes(targetType)) dependents.push(name);
    }
    return dependents;
}

/** Compute registry-wide statistics. @internal */
export interface IModuleRegistryStats {
    totalModules: number;
    initializedModules: number;
    enabledModules: number;
    modulesByType: Record<string, number>;
    totalExecutions: number;
    totalSuccessfulExecutions: number;
    totalFailedExecutions: number;
    averageExecutionTime: number;
}

/** @internal */
export interface IModuleExecutionStats {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    lastExecutionTime?: Date;
    totalExecutionTime: number;
}

/** Build registry stats. @internal */
export function buildRegistryStats(
    modules: Map<string, IModule>,
    moduleStats: Map<string, IModuleExecutionStats>
): IModuleRegistryStats {
    const modulesByType: Record<string, number> = {};
    let initializedModules = 0;
    let enabledModules = 0;
    let totalExecutions = 0;
    let totalSuccessfulExecutions = 0;
    let totalFailedExecutions = 0;
    let totalExecutionTime = 0;

    for (const module of modules.values()) {
        const type = module.getModuleType().type;
        modulesByType[type] = (modulesByType[type] || 0) + 1;
        if (module.isInitialized()) initializedModules++;
        if (module.isEnabled()) enabledModules++;
    }
    for (const stats of moduleStats.values()) {
        totalExecutions += stats.totalExecutions;
        totalSuccessfulExecutions += stats.successfulExecutions;
        totalFailedExecutions += stats.failedExecutions;
        totalExecutionTime += stats.totalExecutionTime;
    }

    return {
        totalModules: modules.size, initializedModules, enabledModules, modulesByType,
        totalExecutions, totalSuccessfulExecutions, totalFailedExecutions,
        averageExecutionTime: totalExecutions > 0 ? totalExecutionTime / totalExecutions : 0
    };
}
