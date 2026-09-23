import type { IDagError } from '../types/error.js';
import type { IRunDraft, ISaveRunDraftInput } from '../types/run-draft.js';
import type { IRunResult } from '../types/run-result.js';
import type { TNodeStateMap } from '../types/node-state.js';
import type { TPortPayload, TPortValue } from '../interfaces/ports.js';
import type { IOverwriteRunDraftNodeResultInput } from '../interfaces/run-draft-operations-port.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';
import { decodeDagDefinition } from './dag-definition-decoder.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function primitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function portValue(value: unknown): value is TPortValue {
  if (primitive(value)) return true;
  if (Array.isArray(value)) return value.every(portValue);
  return record(value) && Object.values(value).every(primitive);
}

function payload(value: unknown): value is TPortPayload {
  return record(value) && Object.values(value).every(portValue);
}

function nodeStateMap(value: unknown): value is TNodeStateMap {
  return (
    record(value) &&
    Object.values(value).every(
      (state) =>
        record(state) &&
        (state['operationStatus'] === 'idle' || state['operationStatus'] === 'uploading') &&
        ['idle', 'running', 'success', 'failed'].includes(String(state['executionStatus'])) &&
        (state['pendingDescription'] === undefined ||
          typeof state['pendingDescription'] === 'string') &&
        (state['trace'] === undefined ||
          (record(state['trace']) &&
            nonempty(state['trace']['nodeId']) &&
            (state['trace']['input'] === undefined || payload(state['trace']['input'])) &&
            (state['trace']['output'] === undefined || payload(state['trace']['output'])))),
    )
  );
}

function dagError(value: unknown): value is IDagError {
  return (
    record(value) &&
    nonempty(value['code']) &&
    nonempty(value['message']) &&
    typeof value['retryable'] === 'boolean' &&
    ['validation', 'state_transition', 'lease', 'dispatch', 'task_execution'].includes(
      String(value['category']),
    )
  );
}

function runResult(value: unknown): value is IRunResult {
  return (
    record(value) &&
    nonempty(value['dagRunId']) &&
    (value['status'] === 'success' || value['status'] === 'failed') &&
    typeof value['totalCredits'] === 'number' &&
    Number.isFinite(value['totalCredits']) &&
    Array.isArray(value['traces']) &&
    value['traces'].every(
      (trace: unknown) =>
        record(trace) &&
        nonempty(trace['nodeId']) &&
        nonempty(trace['nodeType']) &&
        payload(trace['input']) &&
        payload(trace['output']) &&
        typeof trace['estimatedCredits'] === 'number' &&
        Number.isFinite(trace['estimatedCredits']) &&
        typeof trace['totalCredits'] === 'number' &&
        Number.isFinite(trace['totalCredits']),
    ) &&
    Array.isArray(value['nodeErrors']) &&
    value['nodeErrors'].every(
      (entry: unknown) =>
        record(entry) &&
        nonempty(entry['nodeId']) &&
        nonempty(entry['nodeType']) &&
        dagError(entry['error']) &&
        nonempty(entry['occurredAt']),
    )
  );
}

function received(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalid<T>(field: string, expected: string, value: unknown): TResult<T, IDagError> {
  return {
    ok: false,
    error: buildValidationError(
      'DAG_RUN_DRAFT_INVALID_INPUT',
      `${field}: expected ${expected}; received ${received(value)}.`,
      { field, expected, received: received(value) },
    ),
  };
}

/** Decode external create/replace JSON once before calling a run-draft capability. */
export function decodeSaveRunDraftInput(value: unknown): TResult<ISaveRunDraftInput, IDagError> {
  if (!record(value)) return invalid('root', 'object', value);
  if (value['draftId'] !== undefined && !nonempty(value['draftId'])) {
    return invalid('draftId', 'nonempty string', value['draftId']);
  }
  const definition = decodeDagDefinition(value['definition']);
  if (!definition.ok) {
    const first = definition.error[0];
    return invalid(
      `definition${first?.path ? `.${first.path}` : ''}`,
      'valid DAG field',
      value['definition'],
    );
  }
  if (value['input'] !== undefined && !payload(value['input'])) {
    return invalid('input', 'port payload object', value['input']);
  }
  if (value['nodeStateMap'] !== undefined && !nodeStateMap(value['nodeStateMap'])) {
    return invalid('nodeStateMap', 'node-state map object', value['nodeStateMap']);
  }
  if (value['runResult'] !== undefined && !runResult(value['runResult'])) {
    return invalid('runResult', 'run result object', value['runResult']);
  }
  return {
    ok: true,
    value: {
      ...(value['draftId'] !== undefined ? { draftId: value['draftId'] } : {}),
      definition: definition.value,
      ...(value['input'] !== undefined ? { input: value['input'] } : {}),
      ...(value['nodeStateMap'] !== undefined ? { nodeStateMap: value['nodeStateMap'] } : {}),
      ...(value['runResult'] !== undefined ? { runResult: value['runResult'] } : {}),
    },
  };
}

/** Decode external node-result replacement JSON. */
export function decodeOverwriteRunDraftNodeResultInput(
  value: unknown,
): TResult<IOverwriteRunDraftNodeResultInput, IDagError> {
  if (!record(value)) return invalid('root', 'object', value);
  if (value['input'] !== undefined && !payload(value['input'])) {
    return invalid('input', 'port payload object', value['input']);
  }
  if (!payload(value['output'])) return invalid('output', 'port payload object', value['output']);
  return {
    ok: true,
    value: {
      ...(value['input'] !== undefined ? { input: value['input'] } : {}),
      output: value['output'],
    },
  };
}

/** Decode an untrusted HTTP response draft, including the caller-visible state fields. */
export function decodeRunDraft(value: unknown): TResult<IRunDraft, IDagError> {
  const input = decodeSaveRunDraftInput(value);
  if (!input.ok) return input;
  if (!record(value)) return invalid('root', 'object', value);
  if (!nonempty(value['draftId'])) return invalid('draftId', 'nonempty string', value['draftId']);
  if (!payload(value['input'])) return invalid('input', 'port payload object', value['input']);
  if (!nodeStateMap(value['nodeStateMap'])) {
    return invalid('nodeStateMap', 'node-state map object', value['nodeStateMap']);
  }
  if (!nonempty(value['createdAt']))
    return invalid('createdAt', 'nonempty string', value['createdAt']);
  if (!nonempty(value['updatedAt']))
    return invalid('updatedAt', 'nonempty string', value['updatedAt']);
  return {
    ok: true,
    value: {
      draftId: value['draftId'],
      definition: input.value.definition,
      input: value['input'],
      nodeStateMap: value['nodeStateMap'],
      ...(input.value.runResult ? { runResult: input.value.runResult } : {}),
      createdAt: value['createdAt'],
      updatedAt: value['updatedAt'],
    },
  };
}
