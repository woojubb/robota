import {
  buildDagError,
  decodeRunDraft,
  type IDagError,
  type IRunDraft,
  type TResult,
} from '@robota-sdk/dag-core';
import type { IDagOrchestrationHttpResponse } from './orchestration-http-contracts.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Convert the existing HTTP envelope into one trusted domain draft result. */
export function decodeRunDraftResponse(
  response: IDagOrchestrationHttpResponse,
): TResult<IRunDraft, IDagError> {
  if (!response.ok) {
    const first = Array.isArray(response.payload.errors) ? response.payload.errors[0] : undefined;
    const code =
      typeof first?.code === 'string' && /^DAG_RUN_DRAFT_[A-Z0-9_]+$/.test(first.code)
        ? first.code
        : response.status === 404
          ? 'DAG_RUN_DRAFT_NOT_FOUND'
          : response.status >= 500
            ? 'DAG_RUN_DRAFT_SERVER_ERROR'
            : 'DAG_RUN_DRAFT_INVALID_INPUT';
    const message =
      response.status >= 500
        ? 'Run draft operation failed on server.'
        : typeof first?.detail === 'string'
          ? first.detail
          : 'Run draft operation failed.';
    return {
      ok: false,
      error: buildDagError(
        response.status >= 500 ? 'dispatch' : 'validation',
        code,
        message,
        response.status >= 500 && response.status !== 501,
      ),
    };
  }
  const data: unknown = response.payload['data'];
  const decoded = decodeRunDraft(record(data) ? data['draft'] : undefined);
  return decoded.ok
    ? decoded
    : {
        ok: false,
        error: buildDagError(
          'validation',
          'DAG_RUN_DRAFT_INVALID_RESPONSE',
          `Invalid run draft response from server: ${decoded.error.message}`,
          false,
        ),
      };
}

export function runDraftTransportFailure(_cause: unknown): TResult<never, IDagError> {
  return {
    ok: false,
    error: buildDagError(
      'dispatch',
      'DAG_RUN_DRAFT_TRANSPORT_ERROR',
      'Run draft request failed in transport.',
      true,
    ),
  };
}

export function runDraftInvalidResponse(): TResult<never, IDagError> {
  return {
    ok: false,
    error: buildDagError(
      'validation',
      'DAG_RUN_DRAFT_INVALID_RESPONSE',
      'Invalid run draft response from server.',
      false,
    ),
  };
}

/** Preserve a retryable server failure even when its body is not a JSON envelope. */
export function runDraftUnparseableResponse(status: number): TResult<IRunDraft, IDagError> {
  return status >= 500
    ? decodeRunDraftResponse({ ok: false, status, payload: {} })
    : runDraftInvalidResponse();
}
