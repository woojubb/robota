// Utility exports
export * from './message-converter';
export * from './logger';
export * from './validation';
export * from './errors';
export * from './periodic-task';
export * from './platform-shell';

/**
 * Cross-platform timer identifier type
 * Works in both Node.js and browser environments
 */
export type TTimerId = ReturnType<typeof setTimeout>;
