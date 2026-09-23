import { ToolExecutionError } from '../utils/errors';

import type { IToolResult } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';

/** Adapt a tool envelope to the executor value contract without turning failures into success. */
export function toolResultValue(name: string, result: IToolResult): TUniversalValue {
  if (!result.success) throw new ToolExecutionError(result.error ?? 'Tool execution failed', name);
  if (result.data === undefined)
    throw new ToolExecutionError('Tool execution succeeded but returned no data', name);
  return result.data;
}
