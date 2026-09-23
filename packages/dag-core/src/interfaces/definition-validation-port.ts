import type { IDagDefinition } from '../types/domain.js';

/** Definition validation independent of any transport response. */
export interface IDagValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface IDagValidationPort {
  validateDag(definition: IDagDefinition): Promise<IDagValidationResult>;
}
