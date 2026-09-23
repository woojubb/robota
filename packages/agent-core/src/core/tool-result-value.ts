import { ToolExecutionError } from '../utils/errors';

import type { IToolResult } from '../interfaces/tool';
import type { TUniversalValue } from '../interfaces/types';

/** Adapt a tool envelope to the executor value contract without turning failures into success. */
export function toolResultValue(name: string, result: IToolResult): TUniversalValue {
  if (!result.success) {
    const detail =
      result.data === undefined
        ? ''
        : `; data: ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`;
    throw new ToolExecutionError(`${result.error ?? 'Tool execution failed'}${detail}`, name);
  }
  if (result.data === undefined)
    throw new ToolExecutionError('Tool execution succeeded but returned no data', name);
  return result.data;
}
