import type {
  IDagDefinition,
  IRunResult,
  TNodeStateMap,
  TPortPayload,
  TPortValue,
} from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  TDagOrchestrationCreateRunDraftRequest,
} from '@robota-sdk/dag-orchestration-client';
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from './route-utils.js';

export interface IProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  retryable: boolean;
}

type TRequestBodyValue =
  | TPortValue
  | IDagDefinition
  | TNodeStateMap
  | IRunResult
  | TPortPayload
  | IRequestBodyRecord
  | TRequestBodyValue[]
  | undefined;

interface IRequestBodyRecord {
  [key: string]: TRequestBodyValue;
}

export function parseSaveRunDraftBody(
  value: TRequestBodyValue,
  instance: string,
):
  | { ok: true; value: TDagOrchestrationCreateRunDraftRequest }
  | { ok: false; error: IProblemDetails } {
  if (!isRecord(value) || !isDagDefinition(value.definition)) {
    return { ok: false, error: createInvalidDraftProblem(instance) };
  }
  return {
    ok: true,
    value: {
      draftId:
        typeof value.draftId === 'string' && value.draftId.trim().length > 0
          ? value.draftId.trim()
          : undefined,
      definition: value.definition,
      input: parseOptionalPayload(value.input),
      nodeStateMap: isNodeStateMap(value.nodeStateMap) ? value.nodeStateMap : undefined,
      runResult: isRunResult(value.runResult) ? value.runResult : undefined,
    },
  };
}

export function parseOverwritePayload(
  value: TRequestBodyValue,
  instance: string,
):
  | { ok: true; value: IDagOrchestrationOverwriteRunDraftNodeResultRequest }
  | { ok: false; error: IProblemDetails } {
  if (!isRecord(value)) {
    return { ok: false, error: createInvalidDraftProblem(instance) };
  }
  const output = parseOptionalPayload(value.output);
  if (!output) {
    return {
      ok: false,
      error: createProblem(
        HTTP_BAD_REQUEST,
        'DAG_VALIDATION_RUN_DRAFT_INVALID',
        'output must be an object',
        instance,
      ),
    };
  }
  return {
    ok: true,
    value: {
      input: parseOptionalPayload(value.input),
      output,
    },
  };
}

export function createProblem(
  status: number,
  code: string,
  detail: string,
  instance: string,
): IProblemDetails {
  return {
    type: 'urn:robota:problems:dag:validation',
    title: status === HTTP_NOT_FOUND ? 'DAG resource not found' : 'DAG validation failed',
    status,
    detail,
    instance,
    code,
    retryable: false,
  };
}

function createInvalidDraftProblem(instance: string): IProblemDetails {
  return createProblem(
    HTTP_BAD_REQUEST,
    'DAG_VALIDATION_RUN_DRAFT_INVALID',
    'Run draft request body is invalid',
    instance,
  );
}

function parseOptionalPayload(value: TRequestBodyValue): TPortPayload | undefined {
  return isPortPayload(value) ? value : undefined;
}

function isRecord(value: TRequestBodyValue): value is IRequestBodyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDagDefinition(value: TRequestBodyValue): value is IDagDefinition {
  return (
    isRecord(value) &&
    typeof value.dagId === 'string' &&
    typeof value.version === 'number' &&
    typeof value.status === 'string' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges)
  );
}

function isPortPayload(value: TRequestBodyValue): value is TPortPayload {
  return isRecord(value);
}

function isNodeStateMap(value: TRequestBodyValue): value is TNodeStateMap {
  return isRecord(value);
}

function isRunResult(value: TRequestBodyValue): value is IRunResult {
  return (
    isRecord(value) &&
    typeof value.dagRunId === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.traces) &&
    Array.isArray(value.nodeErrors) &&
    typeof value.totalCredits === 'number'
  );
}
