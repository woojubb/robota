import type { IDagDefinition, IDagError, TPortPayload, TResult } from '@robota-sdk/dag-core';
import type {
  IRuntimeCreateRunResult,
  IRuntimeRunCancelResult,
  IRuntimeRunReadResult,
  IRuntimeStartRunResult,
} from './controller-service-ports.js';

export interface IPrepareRunInput {
  readonly definition: IDagDefinition;
  readonly input?: TPortPayload;
}

/** Identifies the domain phase that rejected an implicit create-and-publish run preparation. */
export type TPrepareRunError =
  | { readonly phase: 'definition_create' | 'definition_publish'; readonly errors: IDagError[] }
  | { readonly phase: 'run_create'; readonly error: IDagError };

/** In-process run lifecycle without HTTP statuses or response envelopes. */
export interface IDagRunLifecyclePort {
  createRun(input: IPrepareRunInput): Promise<TResult<IRuntimeCreateRunResult, TPrepareRunError>>;
  startRun(preparationId: string): Promise<TResult<IRuntimeStartRunResult, IDagError>>;
  getRun(dagRunId: string): Promise<TResult<IRuntimeRunReadResult, IDagError>>;
  cancelRun(dagRunId: string): Promise<TResult<IRuntimeRunCancelResult, IDagError>>;
  startPublishedWorkflowRun(
    dagId: string,
    input?: TPortPayload,
    version?: number,
  ): Promise<TResult<IRuntimeStartRunResult, IDagError>>;
}
