import type {
  IDagDefinition,
  IRunDraft,
  TNodeStateMap,
  TPortPayload,
  TPortValue,
} from '@robota-sdk/dag-core';
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
  | IRunDraft['runResult']
  | TRequestBodyRecord
  | undefined;

interface TRequestBodyRecord {
  [key: string]: TRequestBodyValue;
}

export function parseSaveRunDraftBody(
  value: TRequestBodyValue,
  instance: string,
):
  | { ok: true; value: Partial<IRunDraft> & { definition: IDagDefinition } }
  | { ok: false; error: IProblemDetails } {
  if (!isRecord(value) || !isRecord(value.definition)) {
    return { ok: false, error: createInvalidDraftProblem(instance) };
  }
  return {
    ok: true,
    value: {
      draftId:
        typeof value.draftId === 'string' && value.draftId.trim().length > 0
          ? value.draftId.trim()
          : undefined,
      definition: value.definition as object as IDagDefinition,
      input: parseOptionalPayload(value.input),
      nodeStateMap: isRecord(value.nodeStateMap)
        ? (value.nodeStateMap as object as TNodeStateMap)
        : undefined,
      runResult: isRecord(value.runResult)
        ? (value.runResult as object as IRunDraft['runResult'])
        : undefined,
    },
  };
}

export function parseOverwritePayload(
  value: TRequestBodyValue,
  instance: string,
):
  | { ok: true; value: { input?: TPortPayload; output: TPortPayload } }
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
  if (!isRecord(value)) {
    return undefined;
  }
  return value as object as TPortPayload;
}

function isRecord(value: TRequestBodyValue): value is TRequestBodyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
