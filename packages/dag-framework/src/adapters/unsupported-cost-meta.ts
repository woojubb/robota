import type {
  ICostMeta,
  ICostMetaFormulaPreviewInput,
  ICostMetaFormulaValidation,
  ICostMetaFormulaValidationInput,
  ICostMetaOperationsPort,
} from '@robota-sdk/dag-cost';
import type { IDagError, TResult } from '@robota-sdk/dag-core';

/** Explicitly unavailable until cost storage and formula execution are wired safely. */
export class UnsupportedCostMetaOperations implements ICostMetaOperationsPort {
  public async listCostMeta(): Promise<TResult<readonly ICostMeta[], IDagError>> {
    return unsupported();
  }

  public async getCostMeta(_nodeType: string): Promise<TResult<ICostMeta, IDagError>> {
    return unsupported();
  }

  public async createCostMeta(_input: ICostMeta): Promise<TResult<ICostMeta, IDagError>> {
    return unsupported();
  }

  public async updateCostMeta(
    _nodeType: string,
    _input: ICostMeta,
  ): Promise<TResult<ICostMeta, IDagError>> {
    return unsupported();
  }

  public async deleteCostMeta(
    _nodeType: string,
  ): Promise<TResult<{ readonly nodeType: string }, IDagError>> {
    return unsupported();
  }

  public async validateCostMetaFormula(
    _input: ICostMetaFormulaValidationInput,
  ): Promise<TResult<ICostMetaFormulaValidation, IDagError>> {
    return unsupported();
  }

  public async previewCostMetaFormula(
    _input: ICostMetaFormulaPreviewInput,
  ): Promise<TResult<number, IDagError>> {
    return unsupported();
  }
}

function unsupported<T>(): TResult<T, IDagError> {
  return {
    ok: false,
    error: {
      code: 'DAG_COST_META_UNSUPPORTED',
      category: 'validation',
      message: 'Cost metadata operations are not available in this DAG framework composition.',
      retryable: false,
    },
  };
}
