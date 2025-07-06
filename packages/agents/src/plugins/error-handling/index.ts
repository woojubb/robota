/**
 * ErrorHandling Plugin - Centralized exports for Facade pattern
 * 
 * This module provides a clean interface for error handling functionality
 * with proper type safety and context adaptation.
 */

// Core types
export type {
    ErrorHandlingStrategy,
    ErrorHandlingContextData,
    ErrorHandlingPluginOptions,
    ErrorHandlingPluginStats,
    ErrorContextAdapter
} from './types';

// Context adapter utilities
export {
    toErrorContext,
    createPluginErrorContext
} from './context-adapter';

export { ErrorHandlingPlugin } from './error-handling-plugin'; 