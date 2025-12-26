import type { IAbstractLogger } from "./abstract-logger";

/**
 * Simple logger type - convenience alias for IAbstractLogger
 * 
 * This is a type alias that extends IAbstractLogger for backward compatibility
 * and convenience. It provides the same interface as IAbstractLogger.
 * 
 * TYPE HIERARCHY:
 * IAbstractLogger (interface) ← Base type
 *     ↓
 * SimpleLogger (alias) ← This type
 *     ↓
 * SilentLogger, ConsoleLogger (implementations)
 */
export type SimpleLogger = IAbstractLogger;

/**
 * Silent logger that does nothing (concrete implementation)
 * 
 * This is the default Null Object Pattern implementation.
 * Use this in concrete classes when no specific logger is provided.
 * 
 * @example
 * ```typescript
 * // ✅ CORRECT: Use in concrete classes
 * class MyService {
 *   constructor(private logger: SimpleLogger = SilentLogger) {}
 * }
 * ```
 */
export const SilentLogger: SimpleLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    log: () => { },
    group: () => { },
    groupEnd: () => { }
};

/**
 * Default console logger that wraps console methods
 */
export const DefaultConsoleLogger: SimpleLogger = {
    // eslint-disable-next-line no-console
    debug: (...args) => console.debug(...args),
    // eslint-disable-next-line no-console
    info: (...args) => console.info(...args),
    // eslint-disable-next-line no-console
    warn: (...args) => console.warn(...args),
    // eslint-disable-next-line no-console
    error: (...args) => console.error(...args),
    // eslint-disable-next-line no-console
    log: (...args) => console.log(...args),
    // eslint-disable-next-line no-console
    group: (label) => console.group?.(label),
    // eslint-disable-next-line no-console
    groupEnd: () => console.groupEnd?.()
};

/**
 * Stderr-only logger for special environments
 * Only error and warn go to stderr, others are silent
 */
export const StderrLogger: SimpleLogger = {
    // eslint-disable-next-line no-console
    debug: (...args) => console.warn(...args),
    // eslint-disable-next-line no-console
    info: (...args) => console.warn(...args),
    // eslint-disable-next-line no-console
    warn: (...args) => console.warn(...args),
    // eslint-disable-next-line no-console
    error: (...args) => console.error(...args),
    // eslint-disable-next-line no-console
    log: (...args) => console.log(...args),
    // eslint-disable-next-line no-console
    group: (label) => console.group?.(label),
    // eslint-disable-next-line no-console
    groupEnd: () => console.groupEnd?.()
}; 