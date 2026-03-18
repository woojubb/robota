/**
 * Builtin type registrations and helper logic for ModuleDescriptorRegistry.
 *
 * Extracted from module-type-registry.ts to keep each file under 300 lines.
 * @internal
 */
import type { IModuleDescriptor } from '../abstracts/abstract-module';
import { ModuleCategory, ModuleLayer } from '../abstracts/abstract-module';
import type {
  IModuleDescriptorValidationResult,
  IModuleDependencyResolution,
} from './module-type-registry';

/** @internal */
export function getBuiltinTypeDescriptors(): IModuleDescriptor[] {
  return [
    {
      type: 'storage',
      category: ModuleCategory.STORAGE,
      layer: ModuleLayer.INFRASTRUCTURE,
      capabilities: ['data-persistence', 'data-retrieval'],
    },
    {
      type: 'memory-storage',
      category: ModuleCategory.STORAGE,
      layer: ModuleLayer.INFRASTRUCTURE,
      dependencies: ['storage'],
      capabilities: ['in-memory-storage', 'fast-access'],
    },
    {
      type: 'file-storage',
      category: ModuleCategory.STORAGE,
      layer: ModuleLayer.INFRASTRUCTURE,
      dependencies: ['storage'],
      capabilities: ['persistent-storage', 'file-system-access'],
    },
    {
      type: 'text-processing',
      category: ModuleCategory.PROCESSING,
      layer: ModuleLayer.APPLICATION,
      capabilities: ['text-analysis', 'content-transformation'],
    },
    {
      type: 'file-processing',
      category: ModuleCategory.PROCESSING,
      layer: ModuleLayer.APPLICATION,
      dependencies: ['storage'],
      capabilities: ['file-parsing', 'content-extraction'],
    },
    {
      type: 'api-integration',
      category: ModuleCategory.INTEGRATION,
      layer: ModuleLayer.APPLICATION,
      capabilities: ['external-api-access', 'data-synchronization'],
    },
    {
      type: 'database-integration',
      category: ModuleCategory.INTEGRATION,
      layer: ModuleLayer.INFRASTRUCTURE,
      dependencies: ['storage'],
      capabilities: ['database-access', 'query-execution'],
    },
    {
      type: 'rag',
      category: ModuleCategory.CAPABILITY,
      layer: ModuleLayer.DOMAIN,
      dependencies: ['storage', 'text-processing'],
      capabilities: ['document-search', 'context-retrieval', 'semantic-search'],
    },
    {
      type: 'speech-processing',
      category: ModuleCategory.CAPABILITY,
      layer: ModuleLayer.DOMAIN,
      capabilities: ['speech-to-text', 'text-to-speech', 'audio-processing'],
    },
    {
      type: 'image-analysis',
      category: ModuleCategory.CAPABILITY,
      layer: ModuleLayer.DOMAIN,
      capabilities: ['image-recognition', 'visual-analysis', 'content-extraction'],
    },
  ];
}

/** Validate a module type descriptor. @internal */
export function validateTypeDescriptor(
  typeDescriptor: IModuleDescriptor,
  getType: (type: string) => IModuleDescriptor | undefined,
): IModuleDescriptorValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!typeDescriptor.type || typeDescriptor.type.trim() === '')
    errors.push('Module type is required and cannot be empty');
  if (!typeDescriptor.category) errors.push('Module category is required');
  if (!typeDescriptor.layer) errors.push('Module layer is required');
  if (typeDescriptor.type && !/^[a-zA-Z][a-zA-Z0-9-_]*$/.test(typeDescriptor.type))
    errors.push(
      'Module type must start with a letter and contain only letters, numbers, hyphens, and underscores',
    );
  if (typeDescriptor.dependencies) {
    for (const dep of typeDescriptor.dependencies) {
      if (!dep || dep.trim() === '') errors.push('Dependencies cannot be empty');
    }
    if (typeDescriptor.dependencies.includes(typeDescriptor.type))
      errors.push('Module cannot depend on itself');
  }
  if (typeDescriptor.capabilities) {
    for (const cap of typeDescriptor.capabilities) {
      if (!cap || cap.trim() === '') errors.push('Capabilities cannot be empty');
    }
  }
  if (typeDescriptor.dependencies) {
    const layerOrder = [
      ModuleLayer.INFRASTRUCTURE,
      ModuleLayer.CORE,
      ModuleLayer.APPLICATION,
      ModuleLayer.DOMAIN,
      ModuleLayer.PRESENTATION,
    ];
    const currentIdx = layerOrder.indexOf(typeDescriptor.layer);
    for (const depType of typeDescriptor.dependencies) {
      const depDesc = getType(depType);
      if (depDesc) {
        const depIdx = layerOrder.indexOf(depDesc.layer);
        if (depIdx > currentIdx)
          warnings.push(
            `Module '${typeDescriptor.type}' (${typeDescriptor.layer}) depends on '${depType}' (${depDesc.layer}) which is in a higher layer`,
          );
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Resolve module dependencies via topological sort. @internal */
export function resolveDependenciesHelper(
  moduleTypes: string[],
  getType: (type: string) => IModuleDescriptor | undefined,
  hasType: (type: string) => boolean,
): IModuleDependencyResolution {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const circularDependencies: string[][] = [];
  const missingDependencies: string[] = [];
  for (const moduleType of moduleTypes) {
    const descriptor = getType(moduleType);
    if (!descriptor) {
      missingDependencies.push(moduleType);
      continue;
    }
    if (descriptor.dependencies) {
      for (const dep of descriptor.dependencies) {
        if (!hasType(dep) && !missingDependencies.includes(dep)) missingDependencies.push(dep);
      }
    }
  }
  const visit = (moduleType: string, path: string[] = []): void => {
    if (visiting.has(moduleType)) {
      const cycleStart = path.indexOf(moduleType);
      circularDependencies.push(path.slice(cycleStart).concat([moduleType]));
      return;
    }
    if (visited.has(moduleType)) return;
    const descriptor = getType(moduleType);
    if (!descriptor) return;
    visiting.add(moduleType);
    const newPath = [...path, moduleType];
    if (descriptor.dependencies) {
      for (const dep of descriptor.dependencies) {
        if (moduleTypes.includes(dep) || hasType(dep)) visit(dep, newPath);
      }
    }
    visiting.delete(moduleType);
    visited.add(moduleType);
    order.push(moduleType);
  };
  for (const moduleType of moduleTypes) {
    if (!visited.has(moduleType)) visit(moduleType);
  }
  return {
    resolved: missingDependencies.length === 0 && circularDependencies.length === 0,
    order,
    circularDependencies,
    missingDependencies,
  };
}

/** Check compatibility between module types. @internal */
export function checkCompatibilityHelper(
  moduleTypes: string[],
  getType: (type: string) => IModuleDescriptor | undefined,
): {
  compatible: boolean;
  conflicts: Array<{ module1: string; module2: string; reason: string }>;
  suggestions: string[];
} {
  const conflicts: Array<{ module1: string; module2: string; reason: string }> = [];
  const suggestions: string[] = [];
  const modulesByLayer = new Map<ModuleLayer, string[]>();
  for (const moduleType of moduleTypes) {
    const descriptor = getType(moduleType);
    if (descriptor) {
      if (!modulesByLayer.has(descriptor.layer)) modulesByLayer.set(descriptor.layer, []);
      modulesByLayer.get(descriptor.layer)!.push(moduleType);
    }
  }
  const capabilityProviders = new Map<string, string[]>();
  for (const moduleType of moduleTypes) {
    const descriptor = getType(moduleType);
    if (descriptor?.capabilities) {
      for (const cap of descriptor.capabilities) {
        if (!capabilityProviders.has(cap)) capabilityProviders.set(cap, []);
        capabilityProviders.get(cap)!.push(moduleType);
      }
    }
  }
  for (const [capability, providers] of Array.from(capabilityProviders.entries())) {
    if (providers.length > 1) {
      for (let i = 0; i < providers.length; i++) {
        for (let j = i + 1; j < providers.length; j++) {
          const m1 = providers[i];
          const m2 = providers[j];
          if (m1 && m2)
            conflicts.push({
              module1: m1,
              module2: m2,
              reason: `Both modules provide capability '${capability}'`,
            });
        }
      }
    }
  }
  if (conflicts.length > 0) {
    suggestions.push('Consider using only one module per capability');
    suggestions.push('Check if modules can be configured to avoid conflicts');
  }
  if (!modulesByLayer.has(ModuleLayer.INFRASTRUCTURE) && moduleTypes.length > 1)
    suggestions.push('Consider adding infrastructure modules for better foundation');
  return { compatible: conflicts.length === 0, conflicts, suggestions };
}

/** Build registry stats. @internal */
export function buildTypeRegistryStats(registeredTypes: Map<string, IModuleDescriptor>): {
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
    [ModuleCategory.CAPABILITY]: 0,
  };
  const typesByLayer: Record<ModuleLayer, number> = {
    [ModuleLayer.INFRASTRUCTURE]: 0,
    [ModuleLayer.CORE]: 0,
    [ModuleLayer.APPLICATION]: 0,
    [ModuleLayer.DOMAIN]: 0,
    [ModuleLayer.PRESENTATION]: 0,
  };
  let typesWithDependencies = 0;
  let typesWithCapabilities = 0;
  for (const descriptor of registeredTypes.values()) {
    typesByCategory[descriptor.category]++;
    typesByLayer[descriptor.layer]++;
    if (descriptor.dependencies && descriptor.dependencies.length > 0) typesWithDependencies++;
    if (descriptor.capabilities && descriptor.capabilities.length > 0) typesWithCapabilities++;
  }
  return {
    totalTypes: registeredTypes.size,
    typesByCategory,
    typesByLayer,
    typesWithDependencies,
    typesWithCapabilities,
  };
}
