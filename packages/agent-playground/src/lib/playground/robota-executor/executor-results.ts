import type { IVisualizationData } from '../plugins/playground-history-plugin';
import type { IPlaygroundExecutorResult } from '../robota-executor-types';
import { toPlaygroundUiError } from '../robota-executor-types';

type TExecutionErrorInput = Error | string;

interface ISuccessResultInput {
  response: string;
  duration: number;
  visualizationData?: IVisualizationData;
  includeUiError?: boolean;
}

interface IFailureResultInput {
  response: string;
  duration: number;
  error: TExecutionErrorInput;
  visualizationData?: IVisualizationData;
  includeUiError?: boolean;
}

export function createSuccessResult(input: ISuccessResultInput): IPlaygroundExecutorResult {
  const result: IPlaygroundExecutorResult = {
    success: true,
    response: input.response,
    duration: input.duration,
    visualizationData: input.visualizationData,
  };

  if (input.includeUiError) {
    result.uiError = undefined;
  }

  return result;
}

export function createFailureResult(input: IFailureResultInput): IPlaygroundExecutorResult {
  const error = toExecutionError(input.error);
  const result: IPlaygroundExecutorResult = {
    success: false,
    response: input.response,
    duration: input.duration,
    error,
    visualizationData: input.visualizationData,
  };

  if (input.includeUiError) {
    result.uiError = toPlaygroundUiError(error);
  }

  return result;
}

export function toExecutionError(error: TExecutionErrorInput): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function getExecutionErrorMessage(error: TExecutionErrorInput): string {
  return error instanceof Error ? error.message : String(error);
}
