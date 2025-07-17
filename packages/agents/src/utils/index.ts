// Utility exports
export * from './message-converter';
export * from './logger';
export * from './simple-logger';
export * from './validation';
export * from './errors';

/**
 * Cross-platform timer identifier type
 * Works in both Node.js and browser environments
 */
export type TimerId = ReturnType<typeof setTimeout>; 