/**
 * Base Types for Robota SDK
 * 
 * Core primitive and utility types that are reused across the entire codebase.
 * These types form the foundation for all other type definitions.
 */

/**
 * Primitive value types
 */
export type primitive = string | number | boolean | undefined;

/**
 * Recursive configuration value type
 * Supports nested objects and arrays for complex configuration structures
 */
export type ConfigValue = 
    | primitive
    | Date
    | ConfigValue[]
    | { [key: string]: ConfigValue }
    | undefined;

/**
 * Generic configuration object
 * Base type for all configuration objects across the SDK
 */
export type GenericConfig = Record<string, ConfigValue>;

/**
 * Metadata value types (includes all ConfigValue plus specific metadata types)
 */
export type MetadataValue = 
    | primitive
    | Date
    | Error
    | MetadataValue[]
    | { [key: string]: MetadataValue }
    | undefined;

/**
 * Generic metadata object
 * Base type for all metadata objects across the SDK
 */
export type GenericMetadata = Record<string, MetadataValue>;

/**
 * Basic result wrapper for operations
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, generic-constraint
export interface BaseResult<TData = unknown> {
    success: boolean;
    data?: TData;
    errors: string[];
    warnings: string[];
    metadata?: GenericMetadata;
}

/**
 * Common identifiable entity
 */
export interface Identifiable {
    id: string;
}

/**
 * Common timestamped entity
 */
export interface Timestamped {
    createdAt: Date;
    updatedAt?: Date;
}

/**
 * Common configurable entity
 */
export interface Configurable<TConfig = GenericConfig> {
    config?: TConfig;
}

/**
 * Complete base entity with all common properties
 */
export interface BaseEntity extends Identifiable, Timestamped, Configurable {
    name?: string;
    description?: string;
}