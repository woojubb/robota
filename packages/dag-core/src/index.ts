// @robota-sdk/dag-core
// Core DAG contracts and state rules.

export * from './types/domain.js';
export * from './types/error.js';
export * from './types/result.js';
export * from './interfaces/ports.js';
export * from './constants/status.js';
export * from './constants/events.js';
export * from './state-machines/dag-run-state-machine.js';
export * from './state-machines/task-run-state-machine.js';
export * from './services/definition-validator.js';
export * from './services/definition-service.js';
export * from './services/time-semantics.js';
export * from './utils/error-builders.js';
export * from './testing/index.js';

export const DAG_CORE_PACKAGE_NAME = '@robota-sdk/dag-core';
