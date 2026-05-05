import {
  type CelCostEvaluator,
  type ICostMeta,
  type TCostMetaCategory,
} from '@robota-sdk/dag-cost';
import type {
  IDagOrchestrationJsonObject,
  TDagOrchestrationPayloadValue,
} from '@robota-sdk/dag-orchestration-client';
import { createProblem, type IProblemDetails } from './run-draft-route-utils.js';
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from './route-utils.js';

export interface ICostMetaRouteFailure {
  readonly ok: false;
  readonly status: number;
  readonly errors: readonly IProblemDetails[];
}

export type TCostMetaRouteValue =
  | IDagOrchestrationJsonObject
  | TDagOrchestrationPayloadValue
  | undefined;

interface ICostMetaRequiredFields {
  readonly nodeType: string;
  readonly displayName: string;
  readonly category: TCostMetaCategory;
  readonly estimateFormula: string;
  readonly variables: IDagOrchestrationJsonObject;
}

interface ICostMetaLifecycleFields {
  readonly calculateFormula?: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

const COST_META_CATEGORIES: ReadonlySet<string> = new Set([
  'ai-inference',
  'transform',
  'io',
  'custom',
]);

export function parseFormulaRequest(
  value: TCostMetaRouteValue,
  instance: string,
): { ok: true; formula: string } | ICostMetaRouteFailure {
  if (!isJsonObject(value) || typeof value.formula !== 'string' || value.formula.length === 0) {
    return toCostMetaBadRequest(
      'DAG_VALIDATION_COST_META_FORMULA_REQUIRED',
      'formula must be a non-empty string',
      instance,
    );
  }
  return { ok: true, formula: value.formula };
}

export function parsePreviewRequest(
  value: TCostMetaRouteValue,
  instance: string,
):
  | {
      ok: true;
      formula: string;
      variables: IDagOrchestrationJsonObject;
      testContext: IDagOrchestrationJsonObject;
    }
  | ICostMetaRouteFailure {
  const parsedFormula = parseFormulaRequest(value, instance);
  if (!parsedFormula.ok) return parsedFormula;
  const body = value as IDagOrchestrationJsonObject;
  const variables = readOptionalJsonObject(body.variables, 'variables', instance);
  const testContext = readOptionalJsonObject(body.testContext, 'testContext', instance);
  if (!variables.ok) return variables;
  if (!testContext.ok) return testContext;
  return {
    ok: true,
    formula: parsedFormula.formula,
    variables: variables.value,
    testContext: testContext.value,
  };
}

export function parseCostMeta(
  value: TCostMetaRouteValue,
  nodeTypeOverride: string | undefined,
  instance: string,
): { ok: true; meta: ICostMeta } | ICostMetaRouteFailure {
  if (!isJsonObject(value)) {
    return toInvalidCostMeta('Cost meta request body must be an object', instance);
  }
  const requiredFields = readRequiredCostMetaFields(value, nodeTypeOverride);
  if (!requiredFields) {
    return toInvalidCostMeta(
      'Cost meta must include nodeType, displayName, category, estimateFormula, and variables',
      instance,
    );
  }
  const lifecycleFields = readLifecycleFields(value, instance);
  if (!lifecycleFields.ok) return lifecycleFields;
  return {
    ok: true,
    meta: {
      ...requiredFields,
      ...lifecycleFields.value,
      variables: { ...requiredFields.variables },
    },
  };
}

export function validateCostMetaFormulas(
  evaluator: CelCostEvaluator,
  meta: ICostMeta,
  instance: string,
): ICostMetaRouteFailure | undefined {
  const estimateResult = evaluator.validate(meta.estimateFormula);
  if (!estimateResult.ok) {
    return toCostMetaBadRequest(
      'DAG_VALIDATION_COST_META_ESTIMATE_FORMULA_INVALID',
      `Invalid estimateFormula: ${estimateResult.error.message}`,
      instance,
    );
  }
  return validateCalculateFormula(evaluator, meta, instance);
}

export function toCostMetaBadRequest(
  code: string,
  detail: string,
  instance: string,
): ICostMetaRouteFailure {
  return toFailure(HTTP_BAD_REQUEST, code, detail, instance);
}

export function toCostMetaNotFound(nodeType: string): ICostMetaRouteFailure {
  const instance = `/v1/cost-meta/${nodeType}`;
  return toFailure(
    HTTP_NOT_FOUND,
    'DAG_COST_META_NOT_FOUND',
    `Cost meta not found for nodeType: ${nodeType}`,
    instance,
  );
}

function validateCalculateFormula(
  evaluator: CelCostEvaluator,
  meta: ICostMeta,
  instance: string,
): ICostMetaRouteFailure | undefined {
  if (typeof meta.calculateFormula !== 'string' || meta.calculateFormula.length === 0) {
    return undefined;
  }
  const calculateResult = evaluator.validate(meta.calculateFormula);
  if (calculateResult.ok) return undefined;
  return toCostMetaBadRequest(
    'DAG_VALIDATION_COST_META_CALCULATE_FORMULA_INVALID',
    `Invalid calculateFormula: ${calculateResult.error.message}`,
    instance,
  );
}

function readRequiredCostMetaFields(
  value: IDagOrchestrationJsonObject,
  nodeTypeOverride: string | undefined,
): ICostMetaRequiredFields | undefined {
  const nodeType = nodeTypeOverride ?? readNonEmptyString(value.nodeType);
  const displayName = readNonEmptyString(value.displayName);
  const category = readCostMetaCategory(value.category);
  const estimateFormula = readNonEmptyString(value.estimateFormula);
  const variables = readRequiredJsonObject(value.variables);
  if (!nodeType || !displayName || !category || !estimateFormula || !variables) {
    return undefined;
  }
  return { nodeType, displayName, category, estimateFormula, variables };
}

function readLifecycleFields(
  value: IDagOrchestrationJsonObject,
  instance: string,
): { ok: true; value: ICostMetaLifecycleFields } | ICostMetaRouteFailure {
  if (typeof value.enabled !== 'boolean' || typeof value.updatedAt !== 'string') {
    return toInvalidCostMeta('Cost meta must include enabled and updatedAt fields', instance);
  }
  if (typeof value.calculateFormula !== 'undefined' && typeof value.calculateFormula !== 'string') {
    return toInvalidCostMeta('calculateFormula must be a string when provided', instance);
  }
  return {
    ok: true,
    value: {
      calculateFormula: value.calculateFormula,
      enabled: value.enabled,
      updatedAt: value.updatedAt,
    },
  };
}

function readOptionalJsonObject(
  value: TDagOrchestrationPayloadValue,
  fieldName: string,
  instance: string,
): { ok: true; value: IDagOrchestrationJsonObject } | ICostMetaRouteFailure {
  if (typeof value === 'undefined') {
    return { ok: true, value: {} };
  }
  const parsedValue = readRequiredJsonObject(value);
  if (!parsedValue) {
    return toCostMetaBadRequest(
      'DAG_VALIDATION_COST_META_CONTEXT_INVALID',
      `${fieldName} must be an object when provided`,
      instance,
    );
  }
  return { ok: true, value: parsedValue };
}

function readRequiredJsonObject(
  value: TDagOrchestrationPayloadValue,
): IDagOrchestrationJsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function readNonEmptyString(value: TDagOrchestrationPayloadValue): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readCostMetaCategory(value: TDagOrchestrationPayloadValue): TCostMetaCategory | undefined {
  return typeof value === 'string' && COST_META_CATEGORIES.has(value)
    ? (value as TCostMetaCategory)
    : undefined;
}

function isJsonObject(value: TCostMetaRouteValue): value is IDagOrchestrationJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInvalidCostMeta(detail: string, instance: string): ICostMetaRouteFailure {
  return toCostMetaBadRequest('DAG_VALIDATION_COST_META_INVALID', detail, instance);
}

function toFailure(
  status: number,
  code: string,
  detail: string,
  instance: string,
): ICostMetaRouteFailure {
  return {
    ok: false,
    status,
    errors: [createProblem(status, code, detail, instance)],
  };
}
