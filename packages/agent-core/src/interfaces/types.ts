/**
 * Agent-specific type definitions
 * Local types for agent functionality - not forced to use base types unless needed for cross-connections
 */

export type {
  TPrimitiveValue,
  TUniversalValue,
  TUniversalArrayValue,
  IUniversalObjectValue,
} from './universal-value';
import type {
  TPrimitiveValue,
  TUniversalValue,
  TUniversalArrayValue,
  IUniversalObjectValue,
} from './universal-value';

/**
 * Metadata type - consistent across agent components
 */
export type TMetadataValue = TPrimitiveValue | TUniversalArrayValue | Date;
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
export type TComplexConfigValue = Record<
  string,
  TPrimitiveValue | TUniversalArrayValue | IUniversalObjectValue
>;
export type TConfigValue =
  | TPrimitiveValue
  | TUniversalArrayValue
  | IUniversalObjectValue
  | Array<TComplexConfigValue>
  | Array<Record<string, TPrimitiveValue | TUniversalArrayValue | IUniversalObjectValue>>
  | Array<TComplexConfigValue>
  | TComplexConfigValue;
export type TConfigData = Record<string, TConfigValue>;

/**
 * Tool parameter value type - specific for tool parameters
 */
export type TToolParameters = Record<string, TUniversalValue>;

/**
 * Tool result data type - for tool execution results
 */
// NOTE:
// Tool result values are represented by the canonical TUniversalValue axis.

// NOTE:
// Provider config value types are owned by the provider axis (`interfaces/provider.ts`).
// Avoid defining provider config interfaces in this value axis module.
// Do not introduce duplicate provider config value types here.

// NOTE:
// `IPluginContext` moved to `../abstracts/abstract-plugin-types` (PLG-020 follow-up): it depends
// on `IPluginExecutionResult`, which lives at the abstracts layer, and living here made this leaf
// value-types module reach upward into abstracts — a module-level import cycle. Its only consumer
// outside this file (`services/plugin-hook-dispatcher.ts`) now imports it from there directly.

/**
 * Type utility functions for safe type checking and validation
 * @internal
 */
export const TypeUtils = {
  isPrimitive: (value: TUniversalValue): value is TPrimitiveValue => {
    return (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  },

  isArray: (value: TUniversalValue): value is TUniversalArrayValue => {
    return Array.isArray(value) && value.every((item) => TypeUtils.isUniversalValue(item));
  },

  isObject: (value: TUniversalValue): value is IUniversalObjectValue => {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      Object.values(value).every((val) => TypeUtils.isUniversalValue(val))
    );
  },

  isUniversalValue: (value: TUniversalValue): value is TUniversalValue => {
    if (value instanceof Date) return true;
    return TypeUtils.isPrimitive(value) || TypeUtils.isArray(value) || TypeUtils.isObject(value);
  },
};
