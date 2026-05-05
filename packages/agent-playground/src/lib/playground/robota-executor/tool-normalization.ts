import type { IToolSchema, TToolParameters, TUniversalValue } from '@robota-sdk/agent-core';
import { FunctionTool } from '@robota-sdk/agent-tools';

import type { IPlaygroundTool } from '../robota-executor-types';

export function normalizeTools(tools: IPlaygroundTool[]): FunctionTool[] {
  return tools.map((tool) => (tool instanceof FunctionTool ? tool : buildFunctionTool(tool)));
}

export function buildFunctionTool(tool: IPlaygroundTool): FunctionTool {
  const schema: IToolSchema = {
    name: tool.name,
    description: tool.description || `Playground tool: ${tool.name}`,
    parameters: {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description: 'Value to echo',
        },
      },
    },
  };

  return new FunctionTool(
    schema,
    async (params: TToolParameters): Promise<TUniversalValue> => tool.execute(params),
  );
}
