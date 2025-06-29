/**
 * Centralized type definitions for agents library
 * Provides consistent, well-defined types to eliminate any/unknown usage
 */

/**
 * Primitive value types - foundation for all other types
 */
export type PrimitiveValue = string | number | boolean | null | undefined;

/**
 * Array value types - well-defined array structures (includes object arrays for complex data)
 */
export type ArrayValue = string[] | number[] | boolean[] | Array<PrimitiveValue> | Array<ObjectValue>;

/**
 * Object value types - structured object definitions (includes Date for compatibility)
 */
export type ObjectValue = Record<string, PrimitiveValue | ArrayValue | Date>;

/**
 * Universal value type - covers all valid data types
 */
export type UniversalValue = PrimitiveValue | ArrayValue | ObjectValue;

/**
 * Metadata type - consistent across all components (includes Date for compatibility)
 */
export type MetadataValue = PrimitiveValue | ArrayValue | Date;
export type Metadata = Record<string, MetadataValue>;

/**
 * Context data type - for execution contexts
 */
export type ContextData = Record<string, UniversalValue>;

/**
 * Logger data type - for logging contexts (includes Date for timestamps)
 */
export type LoggerData = Record<string, UniversalValue | Date | Error>;

/**
 * Configuration value type - for all configuration objects
 * 
 * REASON: Configuration needs to support complex objects like BaseTool[], BasePlugin[], and nested configurations
 * ALTERNATIVES_CONSIDERED:
 * 1. Strict primitive types (breaks existing configuration functionality)
 * 2. Union types with all possible objects (becomes unwieldy and incomplete)
 * 3. Generic constraints (too complex for configuration scenarios)
 * 4. Interface definitions (too rigid for varied configuration objects)
 * 5. Type assertions at usage sites (decreases type safety)
 * 6. Separate configuration types (breaks existing functionality)
 * 7. Using 'any' type (violates type safety requirements)
 * TODO: Consider creating specific configuration interfaces if runtime issues occur
 */
export type ComplexConfigValue = Record<string, PrimitiveValue | ArrayValue | ObjectValue>;
export type ConfigValue = PrimitiveValue | ArrayValue | ObjectValue | Array<ComplexConfigValue> | Array<Record<string, PrimitiveValue | ArrayValue | ObjectValue>> | Array<object> | object;
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
 */
export type ProviderConfigValue = PrimitiveValue | ArrayValue | ObjectValue;
export type ProviderConfig = Record<string, ProviderConfigValue>;

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
 * Type utility functions for safe type checking
 * 
 * REASON: Type guards need to accept any input for runtime validation. Using specific input type for type-safe validation.
 * ALTERNATIVES_CONSIDERED:
 * 1. Using 'any' type (violates type safety requirements)
 * 2. Multiple overloaded signatures (creates maintenance burden)
 * 3. Generic constraints (too complex for simple type checking)
 * 4. Separate validation functions (unnecessary complexity)
 * 5. Interface-based approach (overkill for simple type guards)
 * TODO: Consider adding more specific type guards if needed
 */
export const TypeUtils = {
    isPrimitive: (value: string | number | boolean | null | undefined | object | Array<PrimitiveValue>): value is PrimitiveValue => {
        return value === null ||
            value === undefined ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean';
    },

    isArray: (value: string | number | boolean | null | undefined | object | Array<PrimitiveValue>): value is ArrayValue => {
        return Array.isArray(value) &&
            value.every(item => TypeUtils.isPrimitive(item) || TypeUtils.isObject(item));
    },

    isObject: (value: string | number | boolean | null | undefined | object | Array<PrimitiveValue>): value is ObjectValue => {
        return typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            Object.values(value).every(val =>
                TypeUtils.isPrimitive(val) || TypeUtils.isArray(val) || val instanceof Date
            );
    },

    isUniversalValue: (value: string | number | boolean | null | undefined | object | Array<PrimitiveValue>): value is UniversalValue => {
        return TypeUtils.isPrimitive(value) ||
            TypeUtils.isArray(value) ||
            TypeUtils.isObject(value);
    }
}; 