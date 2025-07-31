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
 * Array value types - well-defined array structures
 */
export type ArrayValue = string[] | number[] | boolean[] | Array<PrimitiveValue> | Array<ObjectValue>;

/**
 * Object value types - structured object definitions  
 */
export type ObjectValue = Record<string, PrimitiveValue | ArrayValue | Date>;

/**
 * Universal value type - covers all valid data types
 */
export type UniversalValue = PrimitiveValue | ArrayValue | ObjectValue;

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
export type ToolParameterValue = PrimitiveValue | ArrayValue | ObjectValue;
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
    isPrimitive: (value: UniversalValue | Date | Record<string, UniversalValue>): value is PrimitiveValue => {
        return value === null ||
            value === undefined ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean';
    },

    isArray: (value: UniversalValue | Date | Record<string, UniversalValue>): value is ArrayValue => {
        return Array.isArray(value) &&
            value.every(item => TypeUtils.isPrimitive(item) || TypeUtils.isObject(item));
    },

    isObject: (value: UniversalValue | Date | Record<string, UniversalValue>): value is ObjectValue => {
        return typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            Object.values(value).every(val =>
                TypeUtils.isPrimitive(val) || TypeUtils.isArray(val) || val instanceof Date
            );
    },

    isUniversalValue: (value: UniversalValue | Date | Record<string, UniversalValue>): value is UniversalValue => {
        return TypeUtils.isPrimitive(value) ||
            TypeUtils.isArray(value) ||
            TypeUtils.isObject(value);
    }
}; 