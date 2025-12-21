/**
 * Agent-specific type definitions
 * Local types for agent functionality - not forced to use base types unless needed for cross-connections
 */

/**
 * Primitive value types - foundation for all other types
 * Extended to include null/undefined for agent contexts
 */
export type TPrimitiveValue = string | number | boolean | null | undefined;

/**
 * Universal value type axis (recursive, JSON-like + Date).
 *
 * IMPORTANT:
 * - This axis is the single source of truth for payload/context/result values.
 * - It must support nested objects/arrays without `any`/`unknown`.
 */
export type TUniversalValue =
    | TPrimitiveValue
    | Date
    | IUniversalArrayValue
    | IUniversalObjectValue;

export type IUniversalArrayValue = TUniversalValue[];

export interface IUniversalObjectValue {
    [key: string]: TUniversalValue;
}

/**
 * Metadata type - consistent across agent components
 */
export type TMetadataValue = TPrimitiveValue | IUniversalArrayValue | Date;
export type TMetadata = Record<string, TMetadataValue>;

/**
 * Context data type - for execution contexts
 */
export type TContextData = Record<string, TUniversalValue>;

/**
 * Logger data type - for logging contexts
 */
export type TLoggerData = Record<string, TUniversalValue | Date | Error>;

/**
 * Configuration types - for agent configuration
 */
export type TComplexConfigValue = Record<string, TPrimitiveValue | IUniversalArrayValue | IUniversalObjectValue>;
export type TConfigValue = TPrimitiveValue | IUniversalArrayValue | IUniversalObjectValue | Array<TComplexConfigValue> | Array<Record<string, TPrimitiveValue | IUniversalArrayValue | IUniversalObjectValue>> | Array<TComplexConfigValue> | TComplexConfigValue;
export type TConfigData = Record<string, TConfigValue>;

/**
 * Tool parameter value type - specific for tool parameters
 */
export type TToolParameterValue = TUniversalValue;
export type TToolParameters = Record<string, TToolParameterValue>;

/**
 * Tool result data type - for tool execution results
 */
export type TToolResultData = TUniversalValue;

/**
 * Provider configuration value type - for AI provider configs
 * Note: ProviderConfig is defined in agent.ts to avoid export conflicts
 */
export type ProviderConfigValue = TPrimitiveValue | IUniversalArrayValue | IUniversalObjectValue;

/**
 * Plugin context type - for plugin execution contexts
 */
export interface PluginContext {
    input?: string;
    response?: string;
    messages?: Array<Record<string, TUniversalValue>>;
    metadata?: TMetadata;
    error?: Error;
    executionContext?: TContextData;
}

/**
 * Type utility functions for safe type checking and validation
 * @internal
 */
export const TypeUtils = {
    isPrimitive: (value: TUniversalValue): value is TPrimitiveValue => {
        return value === null ||
            value === undefined ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean';
    },

    isArray: (value: TUniversalValue): value is IUniversalArrayValue => {
        return Array.isArray(value) && value.every(item => TypeUtils.isUniversalValue(item));
    },

    isObject: (value: TUniversalValue): value is IUniversalObjectValue => {
        return typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            !(value instanceof Date) &&
            Object.values(value).every(val => TypeUtils.isUniversalValue(val));
    },

    isUniversalValue: (value: TUniversalValue): value is TUniversalValue => {
        if (value instanceof Date) return true;
        return TypeUtils.isPrimitive(value) || TypeUtils.isArray(value) || TypeUtils.isObject(value);
    }
}; 