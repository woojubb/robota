// Utility exports
export * from './message-converter';
export * from './logger';
export * from './simple-logger';
export * from './validation';
export * from './errors';
export * from './periodic-task';

/**
 * Cross-platform timer identifier type
 * Works in both Node.js and browser environments
 */
export type TTimerId = ReturnType<typeof setTimeout>;