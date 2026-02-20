// @robota-sdk/dag-core
// Core DAG contracts and state rules.

export * from './types/domain.js';
export * from './types/node-lifecycle.js';
export * from './types/error.js';
export * from './types/result.js';
export * from './types/run-progress.js';
export * from './interfaces/ports.js';
export * from './constants/status.js';
export * from './constants/events.js';
export * from './lifecycle/default-node-task-handlers.js';
export * from './lifecycle/abstract-node-definition.js';
export * from './lifecycle/node-io-accessor.js';
export * from './lifecycle/registered-node-lifecycle.js';
export * from './lifecycle/static-node-lifecycle-factory.js';
export * from './registry/static-node-manifest-registry.js';
export * from './state-machines/dag-run-state-machine.js';
export * from './state-machines/task-run-state-machine.js';
export * from './services/definition-validator.js';
export * from './services/definition-service.js';
export * from './services/time-semantics.js';
export * from './services/node-lifecycle-runner.js';
export * from './services/lifecycle-task-executor-port.js';
export * from './utils/node-descriptor.js';
export * from './utils/error-builders.js';
export * from './schemas/media-reference-schema.js';
export * from './value-objects/media-reference.js';
export * from './testing/index.js';

export const DAG_CORE_PACKAGE_NAME = '@robota-sdk/dag-core';
