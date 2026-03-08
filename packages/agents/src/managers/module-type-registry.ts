/**
 * Registry for managing module types dynamically.
 *
 * Builtin registrations and helpers live in ./module-type-registry-helpers.ts.
 */
import { IModuleDescriptor, ModuleCategory, ModuleLayer } from '../abstracts/abstract-module';
import { createLogger, type ILogger } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';
import { getBuiltinTypeDescriptors, validateTypeDescriptor, resolveDependenciesHelper, checkCompatibilityHelper, buildTypeRegistryStats } from './module-type-registry-helpers';

/** Module type validation result */
export interface IModuleDescriptorValidationResult { valid: boolean; errors: string[]; warnings: string[] }

/** Module dependency resolution result */
export interface IModuleDependencyResolution { resolved: boolean; order: string[]; circularDependencies: string[][]; missingDependencies: string[] }

/** Module compatibility check result */
export interface IModuleCompatibilityResult { compatible: boolean; conflicts: Array<{ module1: string; module2: string; reason: string }>; suggestions: string[] }

/**
 * Registry for managing module types dynamically.
 * Provides type validation, dependency resolution, and compatibility checking.
 */
export class ModuleDescriptorRegistry {
    private registeredTypes = new Map<string, IModuleDescriptor>();
    private logger: ILogger;

    constructor() {
        this.logger = createLogger('ModuleDescriptorRegistry');
        this.registerBuiltinTypes();
    }

    registerType(typeDescriptor: IModuleDescriptor): void {
        const validation = this.validateTypeDescriptor(typeDescriptor);
        if (!validation.valid) throw new ConfigurationError(`Invalid module type descriptor: ${validation.errors.join(', ')}`, { type: typeDescriptor.type, errors: validation.errors });
        if (this.registeredTypes.has(typeDescriptor.type)) {
            const existing = this.registeredTypes.get(typeDescriptor.type);
            this.logger.warn('Overriding existing module type', { type: typeDescriptor.type, previousCategory: existing?.category || 'unknown', newCategory: typeDescriptor.category });
        }
        this.registeredTypes.set(typeDescriptor.type, typeDescriptor);
        this.logger.info('Module type registered', { type: typeDescriptor.type, category: typeDescriptor.category, layer: typeDescriptor.layer, dependencies: typeDescriptor.dependencies?.length || 0, capabilities: typeDescriptor.capabilities?.length || 0 });
    }

    unregisterType(type: string): boolean {
        if (!this.registeredTypes.has(type)) return false;
        const dependentTypes = this.findDependentTypes(type);
        if (dependentTypes.length > 0) throw new ConfigurationError(`Cannot unregister module type '${type}' - it is required by: ${dependentTypes.join(', ')}`, { type, dependentTypes });
        this.registeredTypes.delete(type);
        this.logger.info('Module type unregistered', { type });
        return true;
    }

    getType(type: string): IModuleDescriptor | undefined { return this.registeredTypes.get(type); }
    getAllTypes(): IModuleDescriptor[] { return Array.from(this.registeredTypes.values()); }
    getTypesByCategory(category: ModuleCategory): IModuleDescriptor[] { return Array.from(this.registeredTypes.values()).filter(t => t.category === category); }
    getTypesByLayer(layer: ModuleLayer): IModuleDescriptor[] { return Array.from(this.registeredTypes.values()).filter(t => t.layer === layer); }
    hasType(type: string): boolean { return this.registeredTypes.has(type); }

    validateTypeDescriptor(typeDescriptor: IModuleDescriptor): IModuleDescriptorValidationResult {
        return validateTypeDescriptor(typeDescriptor, (t) => this.getType(t));
    }

    resolveDependencies(moduleTypes: string[]): IModuleDependencyResolution {
        return resolveDependenciesHelper(moduleTypes, (t) => this.getType(t), (t) => this.hasType(t));
    }

    checkCompatibility(moduleTypes: string[]): IModuleCompatibilityResult {
        return checkCompatibilityHelper(moduleTypes, (t) => this.getType(t));
    }

    private findDependentTypes(type: string): string[] {
        const deps: string[] = [];
        for (const [rt, desc] of this.registeredTypes) { if (desc.dependencies?.includes(type)) deps.push(rt); }
        return deps;
    }

    private registerBuiltinTypes(): void {
        for (const desc of getBuiltinTypeDescriptors()) this.registerType(desc);
        this.logger.info('Built-in module types registered', { totalTypes: this.registeredTypes.size });
    }

    clearAllTypes(): void { this.registeredTypes.clear(); this.logger.info('All module types cleared'); }

    getStats(): { totalTypes: number; typesByCategory: Record<ModuleCategory, number>; typesByLayer: Record<ModuleLayer, number>; typesWithDependencies: number; typesWithCapabilities: number } {
        return buildTypeRegistryStats(this.registeredTypes);
    }
}
