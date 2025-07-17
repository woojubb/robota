/**
 * Simple logger interface compatible with console object
 * Used for browser compatibility and special environments
 */
export interface SimpleLogger {
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
 * Silent logger that does nothing (default implementation)
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