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
// Backward compat — owner is @robota-sdk/dag-node
export * from '@robota-sdk/dag-node';
export * from './state-machines/dag-run-state-machine.js';
export * from './state-machines/task-run-state-machine.js';
export * from './services/definition-validator.js';
export * from './services/definition-service.js';
export * from './services/time-semantics.js';
export * from './services/node-lifecycle-runner.js';
export * from './services/lifecycle-task-executor-port.js';
export * from './utils/node-descriptor.js';
export * from './utils/error-builders.js';
export * from './testing/index.js';

export type {
    TPrompt, IPromptNodeDef, TPromptInputValue, TPromptLink,
    IPromptRequest, IPromptResponse,
    IQueueStatus, IQueueAction,
    IHistoryEntry, THistory, IOutputAsset,
    INodeObjectInfo, TObjectInfo, TInputTypeSpec,
    ISystemStats, IWorkflowJson, INodeError,
} from './types/prompt-types.js';
export { isPromptLink } from './types/prompt-types.js';
export type { IPromptBackendPort } from './interfaces/prompt-backend-port.js';
export type {
    IAssetStore,
    IStoredAssetMetadata,
    ICreateAssetInput,
    ICreateAssetReferenceInput,
    IAssetContentResult
} from './interfaces/asset-store-port.js';
export * from './types/run-result.js';

export const DAG_CORE_PACKAGE_NAME = '@robota-sdk/dag-core';
