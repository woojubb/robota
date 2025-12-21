/**
 * Agent-specific type definitions
 * Local types for agent functionality - not forced to use base types unless needed for cross-connections
 */

/**
 * Primitive value types - foundation for all other types
 * Extended to include null/undefined for agent contexts
 */
export type PrimitiveValue = string | number | boolean | null | undefined;

/**
 * Universal value type axis (recursive, JSON-like + Date).
 *
 * IMPORTANT:
 * - This axis is the single source of truth for payload/context/result values.
 * - It must support nested objects/arrays without `any`/`unknown`.
 */
export type UniversalValue =
    | PrimitiveValue
    | Date
    | UniversalArrayValue
    | UniversalObjectValue;

export type UniversalArrayValue = UniversalValue[];

export interface UniversalObjectValue {
    [key: string]: UniversalValue;
}

/**
 * Backward-compatible aliases.
 *
 * NOTE:
 * - These names are used throughout the codebase.
 * - Keep them aligned with the canonical UniversalValue axis.
 */
export type ArrayValue = UniversalArrayValue;
export type ObjectValue = UniversalObjectValue;

/**
 * Metadata type - consistent across agent components
 */
export type MetadataValue = PrimitiveValue | ArrayValue | Date;
export type Metadata = Record<string, MetadataValue>;

/**
 * Context data type - for execution contexts
 */
export type ContextData = Record<string, UniversalValue>;

/**
 * Logger data type - for logging contexts
 */
export type LoggerData = Record<string, UniversalValue | Date | Error>;

/**
 * Configuration types - for agent configuration
 */
export type ComplexConfigValue = Record<string, PrimitiveValue | ArrayValue | ObjectValue>;
export type ConfigValue = PrimitiveValue | ArrayValue | ObjectValue | Array<ComplexConfigValue> | Array<Record<string, PrimitiveValue | ArrayValue | ObjectValue>> | Array<ComplexConfigValue> | ComplexConfigValue;
export type ConfigData = Record<string, ConfigValue>;

/**
 * Tool parameter value type - specific for tool parameters
 */
export type ToolParameterValue = UniversalValue;
export type ToolParameters = Record<string, ToolParameterValue>;

/**
 * Tool result data type - for tool execution results
 */
export type ToolResultData = UniversalValue;

/**
 * Provider configuration value type - for AI provider configs
 * Note: ProviderConfig is defined in agent.ts to avoid export conflicts
 */
export type ProviderConfigValue = PrimitiveValue | ArrayValue | ObjectValue;

/**
 * Plugin context type - for plugin execution contexts
 */
export interface PluginContext {
    input?: string;
    response?: string;
    messages?: Array<Record<string, UniversalValue>>;
    metadata?: Metadata;
    error?: Error;
    executionContext?: ContextData;
}

/**
 * Type utility functions for safe type checking and validation
 * @internal
 */
export const TypeUtils = {
    isPrimitive: (value: UniversalValue): value is PrimitiveValue => {
        return value === null ||
            value === undefined ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean';
    },

    isArray: (value: UniversalValue): value is ArrayValue => {
        return Array.isArray(value) && value.every(item => TypeUtils.isUniversalValue(item));
    },

    isObject: (value: UniversalValue): value is ObjectValue => {
        return typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            !(value instanceof Date) &&
            Object.values(value).every(val => TypeUtils.isUniversalValue(val));
    },

    isUniversalValue: (value: UniversalValue): value is UniversalValue => {
        if (value instanceof Date) return true;
        return TypeUtils.isPrimitive(value) || TypeUtils.isArray(value) || TypeUtils.isObject(value);
    }
}; 