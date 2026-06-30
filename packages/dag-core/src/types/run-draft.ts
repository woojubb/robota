import type { IDagDefinition } from './domain.js';
import type { TNodeStateMap } from './node-state.js';
import type { IRunResult } from './run-result.js';
import type { TPortPayload } from '../interfaces/ports.js';

export interface IPartialRunRequest {
  startNodeId: string;
}

export interface IRunDraft {
  draftId: string;
  definition: IDagDefinition;
  input: TPortPayload;
  nodeStateMap: TNodeStateMap;
  runResult?: IRunResult;
  createdAt: string;
  updatedAt: string;
}

export interface ISaveRunDraftInput {
  draftId?: string;
  definition: IDagDefinition;
  input?: TPortPayload;
  nodeStateMap?: TNodeStateMap;
  runResult?: IRunResult;
}
