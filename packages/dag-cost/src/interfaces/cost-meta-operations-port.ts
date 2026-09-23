import type { IDagError, TResult } from '@robota-sdk/dag-core';
import type { ICostMeta } from '../types/cost-meta-types.js';

export interface ICostMetaFormulaValidationInput {
  readonly formula: string;
}

export interface ICostMetaFormulaPreviewInput extends ICostMetaFormulaValidationInput {
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly testContext?: Readonly<Record<string, unknown>>;
}

export interface ICostMetaFormulaValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Application capability; transport adapters own status codes and response envelopes. */
export interface ICostMetaOperationsPort {
  listCostMeta(): Promise<TResult<readonly ICostMeta[], IDagError>>;
  getCostMeta(nodeType: string): Promise<TResult<ICostMeta, IDagError>>;
  createCostMeta(input: ICostMeta): Promise<TResult<ICostMeta, IDagError>>;
  updateCostMeta(nodeType: string, input: ICostMeta): Promise<TResult<ICostMeta, IDagError>>;
  deleteCostMeta(nodeType: string): Promise<TResult<{ readonly nodeType: string }, IDagError>>;
  validateCostMetaFormula(
    input: ICostMetaFormulaValidationInput,
  ): Promise<TResult<ICostMetaFormulaValidation, IDagError>>;
  previewCostMetaFormula(input: ICostMetaFormulaPreviewInput): Promise<TResult<number, IDagError>>;
}
