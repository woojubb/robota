/**
 * Shared type definitions for the ModuleDescriptorRegistry and its helpers.
 *
 * Extracted so `module-type-registry.ts` and `module-type-registry-helpers.ts` can both
 * depend on these types without importing from one another (avoids a module-level import
 * cycle).
 * @internal
 */

/** Module type validation result */
export interface IModuleDescriptorValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Module dependency resolution result */
export interface IModuleDependencyResolution {
  resolved: boolean;
  order: string[];
  circularDependencies: string[][];
  missingDependencies: string[];
}
