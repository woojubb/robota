import type { IDagDefinition } from '../types/domain.js';
import type { IDagDefinitionSummary } from '../services/definition-summary.js';

/** Definition reads return domain data without an HTTP response envelope. */
export interface IDagDefinitionReadPort {
  listDefinitions(dagId?: string): Promise<readonly IDagDefinitionSummary[]>;
  getDefinition(dagId: string, version?: number): Promise<IDagDefinition | undefined>;
}
