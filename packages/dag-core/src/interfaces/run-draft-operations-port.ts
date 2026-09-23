import type { IDagError } from '../types/error.js';
import type { TPortPayload } from './ports.js';
import type { TResult } from '../types/result.js';
import type { IRunDraft, ISaveRunDraftInput } from '../types/run-draft.js';

/** Domain input for recording one completed draft-node result. */
export interface IOverwriteRunDraftNodeResultInput {
  readonly input?: TPortPayload;
  readonly output: TPortPayload;
}

/** Run-draft editing capability; transport status, paths and envelopes belong to adapters. */
export interface IRunDraftOperationsPort {
  createRunDraft(input: ISaveRunDraftInput): Promise<TResult<IRunDraft, IDagError>>;
  getRunDraft(draftId: string): Promise<TResult<IRunDraft, IDagError>>;
  replaceRunDraft(
    draftId: string,
    input: Omit<ISaveRunDraftInput, 'draftId'>,
  ): Promise<TResult<IRunDraft, IDagError>>;
  resetRunDraftNodeResult(draftId: string, nodeId: string): Promise<TResult<IRunDraft, IDagError>>;
  overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IOverwriteRunDraftNodeResultInput,
  ): Promise<TResult<IRunDraft, IDagError>>;
}
