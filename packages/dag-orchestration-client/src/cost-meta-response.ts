import type { IDagError, TResult } from '@robota-sdk/dag-core';
import type { ICostMeta, ICostMetaFormulaValidation } from '@robota-sdk/dag-cost';
import type { IDagOrchestrationHttpResponse } from './orchestration-http-contracts.js';

type TDecoder<T> = (data: Record<string, unknown>) => T | undefined;

export function decodeCostResponse<T>(
  response: IDagOrchestrationHttpResponse,
  decode: TDecoder<T>,
): TResult<T, IDagError> {
  if (!response.ok) {
    const first = Array.isArray(response.payload.errors) ? response.payload.errors[0] : undefined;
    const message = typeof first?.detail === 'string' ? first.detail : 'Cost operation failed.';
    const code =
      typeof first?.code === 'string' && /^(?:DAG_COST_META_|CEL_)[A-Z0-9_]+$/.test(first.code)
        ? first.code
        : errorCodeForStatus(response.status);
    const retryable =
      code === 'DAG_COST_META_UNSUPPORTED'
        ? false
        : typeof first?.retryable === 'boolean'
          ? first.retryable
          : response.status >= 500;
    return failure(code, message, retryable);
  }
  const data: unknown = response.payload['data'];
  if (!isRecord(data)) {
    return invalidResponse();
  }
  const value = decode(data);
  return value === undefined ? invalidResponse() : { ok: true, value };
}

export function costTransportFailure(cause: unknown): TResult<never, IDagError> {
  const message = cause instanceof Error ? cause.message : String(cause);
  return failure('DAG_COST_META_TRANSPORT_ERROR', message, true);
}

export const decodeCostMetaList: TDecoder<readonly ICostMeta[]> = (data) => {
  const items = data['items'];
  return Array.isArray(items) && items.every(isCostMeta) ? items : undefined;
};

export const decodeCostMeta: TDecoder<ICostMeta> = (data) => {
  const meta = data['meta'];
  return isCostMeta(meta) ? meta : undefined;
};

export const decodeCostMetaDelete: TDecoder<{ readonly nodeType: string }> = (data) => {
  const nodeType = data['nodeType'];
  return typeof nodeType === 'string' ? { nodeType } : undefined;
};

export const decodeCostMetaValidation: TDecoder<ICostMetaFormulaValidation> = (data) => {
  const valid = data['valid'];
  const errors = data['errors'];
  return typeof valid === 'boolean' && Array.isArray(errors) && errors.every(isString)
    ? { valid, errors }
    : undefined;
};

export const decodeCostMetaPreview: TDecoder<number> = (data) => {
  const result = data['result'];
  return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
};

function isCostMeta(value: unknown): value is ICostMeta {
  if (!isRecord(value)) return false;
  const category = value['category'];
  return (
    isNonemptyString(value['nodeType']) &&
    isNonemptyString(value['displayName']) &&
    (category === 'ai-inference' ||
      category === 'transform' ||
      category === 'io' ||
      category === 'custom') &&
    isNonemptyString(value['estimateFormula']) &&
    (value['calculateFormula'] === undefined || isNonemptyString(value['calculateFormula'])) &&
    isRecord(value['variables']) &&
    typeof value['enabled'] === 'boolean' &&
    isNonemptyString(value['updatedAt'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonemptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function errorCodeForStatus(status: number): string {
  if (status === 501) return 'DAG_COST_META_UNSUPPORTED';
  if (status === 404) return 'DAG_COST_META_NOT_FOUND';
  if (status >= 400 && status < 500) return 'DAG_COST_META_INVALID';
  return 'DAG_COST_META_TRANSPORT_ERROR';
}

function invalidResponse<T>(): TResult<T, IDagError> {
  return failure(
    'DAG_COST_META_INVALID_RESPONSE',
    'Invalid cost metadata response from server.',
    false,
  );
}

function failure<T>(code: string, message: string, retryable: boolean): TResult<T, IDagError> {
  return { ok: false, error: { code, category: 'validation', message, retryable } };
}
