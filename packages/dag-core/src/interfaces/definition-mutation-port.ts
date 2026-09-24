import type { IDagDefinition } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';

/** Definition lifecycle changes return domain results without transport envelopes. */
export interface IDagDefinitionMutationPort {
  createDefinition(definition: IDagDefinition): Promise<TResult<IDagDefinition, IDagError[]>>;
  updateDraft(definition: IDagDefinition): Promise<TResult<IDagDefinition, IDagError[]>>;
  validateDefinition(dagId: string, version: number): Promise<TResult<IDagDefinition, IDagError[]>>;
  publishDefinition(dagId: string, version: number): Promise<TResult<IDagDefinition, IDagError[]>>;
}
