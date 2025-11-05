/**
 * @fileoverview Abstract Logger Type Definition
 * 
 * 🎯 ABSTRACT TYPE - Top-level Logger Interface
 * 
 * This defines the abstract logger interface that all logger implementations
 * must follow. It's the highest-level abstraction for logging in the system.
 * 
 * ARCHITECTURAL PRINCIPLES:
 * - Top-level abstraction: All loggers implement this interface
 * - Type hierarchy: AbstractLogger > SimpleLogger > concrete implementations
 * - Zero dependencies: Pure type definition
 * - Interface segregation: Focused on logging responsibilities only
 * 
 * TYPE HIERARCHY:
 * ```
 * AbstractLogger (interface) ← Top level
 *     ↓ extends
 * SimpleLogger (type alias) ← Convenience type
 *     ↓ implements
 * SilentLogger, ConsoleLogger, etc. ← Concrete implementations
 * ```
 * 
 * @example
 * ```typescript
 * // ✅ CORRECT: Type with AbstractLogger
 * class MyBaseClass {
 *   constructor(protected logger: AbstractLogger) {}
 * }
 * 
 * // ✅ CORRECT: Implementation
 * const myLogger: AbstractLogger = {
 *   debug: (msg) => console.debug(msg),
 *   // ... other methods
 * };
 * ```
 */

/**
 * Abstract Logger Interface
 * 
 * Top-level logger abstraction that defines the contract for all logger
 * implementations. This is the highest type in the logger hierarchy.
 * 
 * All logger implementations (SilentLogger, ConsoleLogger, etc.) must
 * implement this interface.
 */
export interface AbstractLogger {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug(...args: any[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    info(...args: any[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn(...args: any[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error(...args: any[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    log(...args: any[]): void;
    group?(label?: string): void;
    groupEnd?(): void;
}

/**
 * Default Abstract Logger Implementation (Null Object Pattern)
 * 
 * This const provides the default "do-nothing" implementation of AbstractLogger.
 * Use this in abstract base classes (base-*, abstract-*) as the default logger.
 * 
 * @example
 * ```typescript
 * // ✅ CORRECT: Use in abstract/base classes
 * abstract class BaseValidator {
 *   constructor(
 *     protected logger: AbstractLogger = DEFAULT_ABSTRACT_LOGGER
 *   ) {}
 * }
 * ```
 */
export const DEFAULT_ABSTRACT_LOGGER: AbstractLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    log: () => { },
    group: () => { },
    groupEnd: () => { }
};

