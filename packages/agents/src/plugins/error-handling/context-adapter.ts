/**
 * ErrorHandling Plugin - Context adapter utilities for Facade pattern
 * 
 * REASON: TypeScript exactOptionalPropertyTypes strict mode requires special handling for optional properties
 * ALTERNATIVES_CONSIDERED: Bracket notation (rejected by TS), type assertions (rejected), interface modification (breaks compatibility), union types (causes dependencies), removing context (loses debugging)
 * TODO: Consider unified error context type system across all plugins
 */

import type { ErrorHandlingContextData, ErrorContextAdapter } from './types';

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
 */
export function createPluginErrorContext(context: ErrorHandlingContextData, additionalData?: Record<string, any>): Record<string, any> {
    return {
        ...toErrorContext(context),
        ...(additionalData && { ...additionalData })
    };
} 