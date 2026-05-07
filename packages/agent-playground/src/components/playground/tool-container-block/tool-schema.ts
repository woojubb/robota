import type { IToolSchema } from '@robota-sdk/agent-core';

import type { IPlaygroundTool } from '../../../lib/playground/robota-executor';

export function getToolSchema(tool: IPlaygroundTool): IToolSchema | undefined {
  if ('schema' in tool && tool.schema) return tool.schema;
  return undefined;
}
