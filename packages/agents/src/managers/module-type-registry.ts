import {
    ModuleTypeDescriptor,
    ModuleCategory,
    ModuleLayer
} from '../abstracts/base-module';
import { Logger, createLogger } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';

/**
 * Module type validation result
 */
export interface ModuleTypeValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Module dependency resolution result
 */
export interface ModuleDependencyResolution {
    resolved: boolean;
    order: string[];
    circularDependencies: string[][];
    missingDependencies: string[];
}

/**
 * Module compatibility check result
 */
export interface ModuleCompatibilityResult {
    compatible: boolean;
    conflicts: Array<{
        module1: string;
        module2: string;
        reason: string;
    }>;
    suggestions: string[];
}

/**
 * Registry for managing module types dynamically
 * Provides type validation, dependency resolution, and compatibility checking
 * 
 * This system allows for:
 * - Dynamic registration of new module types at runtime
 * - Automatic dependency resolution and ordering
 * - Type compatibility validation
 * - Circular dependency detection
 */
export class ModuleTypeRegistry {
    private static instance: ModuleTypeRegistry | null = null;
    private registeredTypes = new Map<string, ModuleTypeDescriptor>();
    private logger: Logger;

    constructor() {
        this.logger = createLogger('ModuleTypeRegistry');
        this.registerBuiltinTypes();
    }

    /**
     * Get singleton instance of ModuleTypeRegistry
     */
    static getInstance(): ModuleTypeRegistry {
        if (!ModuleTypeRegistry.instance) {
            ModuleTypeRegistry.instance = new ModuleTypeRegistry();
        }
        return ModuleTypeRegistry.instance;
    }

    /**
     * Register a new module type
     */
    registerType(typeDescriptor: ModuleTypeDescriptor): void {
        // Validate the type descriptor
        const validation = this.validateTypeDescriptor(typeDescriptor);
        if (!validation.valid) {
            throw new ConfigurationError(
                `Invalid module type descriptor: ${validation.errors.join(', ')}`,
                { type: typeDescriptor.type, errors: validation.errors }
            );
        }

        // Check for conflicts with existing types
        if (this.registeredTypes.has(typeDescriptor.type)) {
            const existingType = this.registeredTypes.get(typeDescriptor.type);
            this.logger.warn('Overriding existing module type', {
                type: typeDescriptor.type,
                previousCategory: (existingType?.category || 'unknown') as string,
                newCategory: typeDescriptor.category as string
            } as any);
        }

        this.registeredTypes.set(typeDescriptor.type, typeDescriptor);

        this.logger.info('Module type registered', {
            type: typeDescriptor.type,
            category: typeDescriptor.category,
            layer: typeDescriptor.layer,
            dependencies: typeDescriptor.dependencies?.length || 0,
            capabilities: typeDescriptor.capabilities?.length || 0
        });
    }

    /**
     * Unregister a module type
     */
    unregisterType(type: string): boolean {
        if (!this.registeredTypes.has(type)) {
            return false;
        }

        // Check if other types depend on this type
        const dependentTypes = this.findDependentTypes(type);
        if (dependentTypes.length > 0) {
            throw new ConfigurationError(
                `Cannot unregister module type '${type}' - it is required by: ${dependentTypes.join(', ')}`,
                { type, dependentTypes }
            );
        }

        this.registeredTypes.delete(type);
        this.logger.info('Module type unregistered', { type });
        return true;
    }

    /**
     * Get a registered module type
     */
    getType(type: string): ModuleTypeDescriptor | null {
        return this.registeredTypes.get(type) || null;
    }

    /**
     * Get all registered module types
     */
    getAllTypes(): ModuleTypeDescriptor[] {
        return Array.from(this.registeredTypes.values());
    }

    /**
     * Get module types by category
     */
    getTypesByCategory(category: ModuleCategory): ModuleTypeDescriptor[] {
        return Array.from(this.registeredTypes.values())
            .filter(type => type.category === category);
    }

    /**
     * Get module types by layer
     */
    getTypesByLayer(layer: ModuleLayer): ModuleTypeDescriptor[] {
        return Array.from(this.registeredTypes.values())
            .filter(type => type.layer === layer);
    }

    /**
     * Check if a module type is registered
     */
    hasType(type: string): boolean {
        return this.registeredTypes.has(type);
    }

    /**
     * Validate module type descriptor
     */
    validateTypeDescriptor(typeDescriptor: ModuleTypeDescriptor): ModuleTypeValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required fields validation
        if (!typeDescriptor.type || typeDescriptor.type.trim() === '') {
            errors.push('Module type is required and cannot be empty');
        }

        if (!typeDescriptor.category) {
            errors.push('Module category is required');
        }

        if (!typeDescriptor.layer) {
            errors.push('Module layer is required');
        }

        // Type name validation
        if (typeDescriptor.type && !/^[a-zA-Z][a-zA-Z0-9-_]*$/.test(typeDescriptor.type)) {
            errors.push('Module type must start with a letter and contain only letters, numbers, hyphens, and underscores');
        }

        // Dependencies validation
        if (typeDescriptor.dependencies) {
            for (const dep of typeDescriptor.dependencies) {
                if (!dep || dep.trim() === '') {
                    errors.push('Dependencies cannot be empty');
                }
            }

            // Check for self-dependency
            if (typeDescriptor.dependencies.includes(typeDescriptor.type)) {
                errors.push('Module cannot depend on itself');
            }
        }

        // Capabilities validation
        if (typeDescriptor.capabilities) {
            for (const capability of typeDescriptor.capabilities) {
                if (!capability || capability.trim() === '') {
                    errors.push('Capabilities cannot be empty');
                }
            }
        }

        // Layer compatibility warnings
        if (typeDescriptor.dependencies) {
            for (const depType of typeDescriptor.dependencies) {
                const depDescriptor = this.getType(depType);
                if (depDescriptor) {
                    const layerOrder = [
                        ModuleLayer.INFRASTRUCTURE,
                        ModuleLayer.CORE,
                        ModuleLayer.APPLICATION,
                        ModuleLayer.DOMAIN,
                        ModuleLayer.PRESENTATION
                    ];

                    const currentLayerIndex = layerOrder.indexOf(typeDescriptor.layer);
                    const depLayerIndex = layerOrder.indexOf(depDescriptor.layer);

                    if (depLayerIndex > currentLayerIndex) {
                        warnings.push(
                            `Module '${typeDescriptor.type}' (${typeDescriptor.layer}) depends on ` +
                            `'${depType}' (${depDescriptor.layer}) which is in a higher layer`
                        );
                    }
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Resolve module dependencies and return initialization order
     */
    resolveDependencies(moduleTypes: string[]): ModuleDependencyResolution {
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const order: string[] = [];
        const circularDependencies: string[][] = [];
        const missingDependencies: string[] = [];

        // Check for missing dependencies first
        for (const moduleType of moduleTypes) {
            const descriptor = this.getType(moduleType);
            if (!descriptor) {
                missingDependencies.push(moduleType);
                continue;
            }

            if (descriptor.dependencies) {
                for (const dep of descriptor.dependencies) {
                    if (!this.hasType(dep) && !missingDependencies.includes(dep)) {
                        missingDependencies.push(dep);
                    }
                }
            }
        }

        // Perform topological sort with cycle detection
        const visit = (moduleType: string, path: string[] = []): void => {
            if (visiting.has(moduleType)) {
                // Circular dependency detected
                const cycleStart = path.indexOf(moduleType);
                const cycle = path.slice(cycleStart).concat([moduleType]);
                circularDependencies.push(cycle);
                return;
            }

            if (visited.has(moduleType)) {
                return;
            }

            const descriptor = this.getType(moduleType);
            if (!descriptor) {
                return;
            }

            visiting.add(moduleType);
            const newPath = [...path, moduleType];

            if (descriptor.dependencies) {
                for (const dep of descriptor.dependencies) {
                    if (moduleTypes.includes(dep) || this.hasType(dep)) {
                        visit(dep, newPath);
                    }
                }
            }

            visiting.delete(moduleType);
            visited.add(moduleType);
            order.push(moduleType);
        };

        for (const moduleType of moduleTypes) {
            if (!visited.has(moduleType)) {
                visit(moduleType);
            }
        }

        return {
            resolved: missingDependencies.length === 0 && circularDependencies.length === 0,
            order,
            circularDependencies,
            missingDependencies
        };
    }

    /**
     * Check compatibility between module types
     */
    checkCompatibility(moduleTypes: string[]): ModuleCompatibilityResult {
        const conflicts: Array<{ module1: string; module2: string; reason: string }> = [];
        const suggestions: string[] = [];

        // Check for layer violations
        const modulesByLayer = new Map<ModuleLayer, string[]>();

        for (const moduleType of moduleTypes) {
            const descriptor = this.getType(moduleType);
            if (descriptor) {
                if (!modulesByLayer.has(descriptor.layer)) {
                    modulesByLayer.set(descriptor.layer, []);
                }
                modulesByLayer.get(descriptor.layer)!.push(moduleType);
            }
        }

        // Check for capability conflicts
        const capabilityProviders = new Map<string, string[]>();

        for (const moduleType of moduleTypes) {
            const descriptor = this.getType(moduleType);
            if (descriptor?.capabilities) {
                for (const capability of descriptor.capabilities) {
                    if (!capabilityProviders.has(capability)) {
                        capabilityProviders.set(capability, []);
                    }
                    capabilityProviders.get(capability)!.push(moduleType);
                }
            }
        }

        // Detect conflicts where multiple modules provide the same capability
        for (const [capability, providers] of Array.from(capabilityProviders.entries())) {
            if (providers.length > 1) {
                for (let i = 0; i < providers.length; i++) {
                    for (let j = i + 1; j < providers.length; j++) {
                        const module1 = providers[i];
                        const module2 = providers[j];
                        if (module1 && module2) {
                            conflicts.push({
                                module1,
                                module2,
                                reason: `Both modules provide capability '${capability}'`
                            });
                        }
                    }
                }
            }
        }

        // Generate suggestions
        if (conflicts.length > 0) {
            suggestions.push('Consider using only one module per capability');
            suggestions.push('Check if modules can be configured to avoid conflicts');
        }

        // Check for missing infrastructure modules
        const hasInfrastructure = modulesByLayer.has(ModuleLayer.INFRASTRUCTURE);
        if (!hasInfrastructure && moduleTypes.length > 1) {
            suggestions.push('Consider adding infrastructure modules for better foundation');
        }

        return {
            compatible: conflicts.length === 0,
            conflicts,
            suggestions
        };
    }

    /**
     * Find types that depend on the given type
     */
    private findDependentTypes(type: string): string[] {
        const dependentTypes: string[] = [];

        for (const [registeredType, descriptor] of this.registeredTypes) {
            if (descriptor.dependencies?.includes(type)) {
                dependentTypes.push(registeredType);
            }
        }

        return dependentTypes;
    }

    /**
     * Register built-in module types
     */
    private registerBuiltinTypes(): void {
        // Storage module types
        this.registerType({
            type: 'storage',
            category: ModuleCategory.STORAGE,
            layer: ModuleLayer.INFRASTRUCTURE,
            capabilities: ['data-persistence', 'data-retrieval']
        });

        this.registerType({
            type: 'memory-storage',
            category: ModuleCategory.STORAGE,
            layer: ModuleLayer.INFRASTRUCTURE,
            dependencies: ['storage'],
            capabilities: ['in-memory-storage', 'fast-access']
        });

        this.registerType({
            type: 'file-storage',
            category: ModuleCategory.STORAGE,
            layer: ModuleLayer.INFRASTRUCTURE,
            dependencies: ['storage'],
            capabilities: ['persistent-storage', 'file-system-access']
        });

        // Processing module types
        this.registerType({
            type: 'text-processing',
            category: ModuleCategory.PROCESSING,
            layer: ModuleLayer.APPLICATION,
            capabilities: ['text-analysis', 'content-transformation']
        });

        this.registerType({
            type: 'file-processing',
            category: ModuleCategory.PROCESSING,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['storage'],
            capabilities: ['file-parsing', 'content-extraction']
        });

        // Integration module types
        this.registerType({
            type: 'api-integration',
            category: ModuleCategory.INTEGRATION,
            layer: ModuleLayer.APPLICATION,
            capabilities: ['external-api-access', 'data-synchronization']
        });

        this.registerType({
            type: 'database-integration',
            category: ModuleCategory.INTEGRATION,
            layer: ModuleLayer.INFRASTRUCTURE,
            dependencies: ['storage'],
            capabilities: ['database-access', 'query-execution']
        });

        // Capability module types
        this.registerType({
            type: 'rag',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['storage', 'text-processing'],
            capabilities: ['document-search', 'context-retrieval', 'semantic-search']
        });

        this.registerType({
            type: 'speech-processing',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            capabilities: ['speech-to-text', 'text-to-speech', 'audio-processing']
        });

        this.registerType({
            type: 'image-analysis',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            capabilities: ['image-recognition', 'visual-analysis', 'content-extraction']
        });

        this.logger.info('Built-in module types registered', {
            totalTypes: this.registeredTypes.size
        });
    }

    /**
     * Clear all registered types (for testing)
     */
    clearAllTypes(): void {
        this.registeredTypes.clear();
        this.logger.info('All module types cleared');
    }

    /**
     * Get registry statistics
     */
    getStats(): {
        totalTypes: number;
        typesByCategory: Record<ModuleCategory, number>;
        typesByLayer: Record<ModuleLayer, number>;
        typesWithDependencies: number;
        typesWithCapabilities: number;
    } {
        const typesByCategory: Record<ModuleCategory, number> = {
            [ModuleCategory.CORE]: 0,
            [ModuleCategory.STORAGE]: 0,
            [ModuleCategory.PROCESSING]: 0,
            [ModuleCategory.INTEGRATION]: 0,
            [ModuleCategory.INTERFACE]: 0,
            [ModuleCategory.CAPABILITY]: 0
        };

        const typesByLayer: Record<ModuleLayer, number> = {
            [ModuleLayer.INFRASTRUCTURE]: 0,
            [ModuleLayer.CORE]: 0,
            [ModuleLayer.APPLICATION]: 0,
            [ModuleLayer.DOMAIN]: 0,
            [ModuleLayer.PRESENTATION]: 0
        };

        let typesWithDependencies = 0;
        let typesWithCapabilities = 0;

        for (const descriptor of this.registeredTypes.values()) {
            typesByCategory[descriptor.category]++;
            typesByLayer[descriptor.layer]++;

            if (descriptor.dependencies && descriptor.dependencies.length > 0) {
                typesWithDependencies++;
            }

            if (descriptor.capabilities && descriptor.capabilities.length > 0) {
                typesWithCapabilities++;
            }
        }

        return {
            totalTypes: this.registeredTypes.size,
            typesByCategory,
            typesByLayer,
            typesWithDependencies,
            typesWithCapabilities
        };
    }
} 