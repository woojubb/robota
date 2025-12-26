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
 * - Type hierarchy: IAbstractLogger > SimpleLogger > concrete implementations
 * - Zero dependencies: Pure type definition
 * - Interface segregation: Focused on logging responsibilities only
 * 
 * TYPE HIERARCHY:
 * ```
 * IAbstractLogger (interface) ← Top level
 *     ↓ extends
 * SimpleLogger (type alias) ← Convenience type
 *     ↓ implements
 * SilentLogger, ConsoleLogger, etc. ← Concrete implementations
 * ```
 * 
 * @example
 * ```typescript
 * // ✅ CORRECT: Type with IAbstractLogger
 * class MyBaseClass {
 *   constructor(protected logger: IAbstractLogger) {}
 * }
 * 
 * // ✅ CORRECT: Implementation
 * const myLogger: IAbstractLogger = {
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
export interface IAbstractLogger {
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
 * This const provides the default "do-nothing" implementation of IAbstractLogger.
 * Use this in abstract base classes (base-*, abstract-*) as the default logger.
 * 
 * @example
 * ```typescript
 * // ✅ CORRECT: Use in abstract/base classes
 * abstract class BaseValidator {
 *   constructor(
 *     protected logger: IAbstractLogger = DEFAULT_ABSTRACT_LOGGER
 *   ) {}
 * }
 * ```
 */
export const DEFAULT_ABSTRACT_LOGGER: IAbstractLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    log: () => { },
    group: () => { },
    groupEnd: () => { }
};

