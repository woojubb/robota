import type { TToolParameters } from './types';

/** Core-owned identity, independent of a provider's reusable tool-call identifier. */
export interface IToolActionIdentity {
  executionId: string;
  actionId: string;
  parentCallId: string;
  toolCallId: string;
  toolName: string;
}

export interface IToolContinuationPrompt {
  kind: string;
  data: TToolParameters;
}

export interface IToolWaitRequest extends IToolActionIdentity, IToolContinuationPrompt {
  requestId: string;
}

export interface IToolWaitResponse {
  requestId: string;
  responseId: string;
  response: TToolParameters;
}

export interface IToolWaitState {
  request: IToolWaitRequest;
  response?: IToolWaitResponse;
}

/** Available before effect admission. The runtime owns interpretation and authorization. */
export interface IToolContinuation {
  readonly action: IToolActionIdentity;
  readonly waits: readonly IToolWaitState[];
  /** Return a saved response or persist a request and suspend this execution. */
  request(prompt: IToolContinuationPrompt): Promise<TToolParameters>;
}
