/**
 * ErrorHandling Plugin - Context adapter utilities for Facade pattern
 * 
 * REASON: TypeScript exactOptionalPropertyTypes strict mode requires special handling for optional properties
 * ALTERNATIVES_CONSIDERED: Bracket notation (rejected by TS), type assertions (rejected), interface modification (breaks compatibility), union types (causes dependencies), removing context (loses debugging)
 * TODO: Consider unified error context type system across all plugins
 */

import type { ErrorHandlingContextData, ErrorContextAdapter } from './types';
import type { ErrorContextData } from '../../utils/errors';

/**
 * Convert ErrorHandlingContextData to ErrorContextData-compatible format for PluginError
 * REASON: Simple object spread with known properties to avoid index signature conflicts
 * ALTERNATIVES_CONSIDERED: Complex type adapters (unnecessary), Object.assign (verbose), bracket notation (rejected by TS), type assertions (reduces safety)
 * TODO: Consider unified error context type system across all plugins
 */
export function toErrorContext(context: ErrorHandlingContextData): ErrorContextAdapter {
    return {
        ...(context.executionId && { executionId: context.executionId }),
        ...(context.sessionId && { sessionId: context.sessionId }),
        ...(context.userId && { userId: context.userId }),
        ...(context.attempt !== undefined && { attempt: context.attempt }),
        ...(context.originalError && { originalError: context.originalError })
    };
}

/**
 * Safe context extraction for PluginError with nested context structure
 * 
 * REASON: PluginError context needs flexible data structure for debugging information
 * ALTERNATIVES_CONSIDERED:
 * 1. Strict primitive types (loses debugging information)
 * 2. Interface definitions (too rigid for error contexts)
 * 3. Union types (becomes unwieldy for error data)
 * 4. Generic constraints (too complex for error handling)
 * 5. Type assertions (decreases type safety)
 * TODO: Consider standardized error context interface if patterns emerge
 */
export function createPluginErrorContext(context: ErrorHandlingContextData, additionalData?: ErrorContextData): ErrorContextData {
    return {
        ...toErrorContext(context),
        ...(additionalData && { ...additionalData })
    };
} 