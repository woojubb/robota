// Utility exports
//
// `path-containment` is NOT here: it imports `node:fs` and `node:path`, and this barrel feeds the
// BROWSER build too (CORE-028). It is exported from `./node.js`, where a consumer asks for it.
export * from './abort-classification';
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
