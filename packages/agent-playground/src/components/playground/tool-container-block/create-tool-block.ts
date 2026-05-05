import type { TUniversalValue } from '@robota-sdk/agent-core';

import type { IToolBlock } from '../tool-container-block-types';
import { AVAILABLE_TOOLS, RANDOM_ID_BASE, RANDOM_ID_LENGTH } from '../tool-container-block-types';

export function createToolBlock(toolName: string): IToolBlock | null {
  const toolDefinition = AVAILABLE_TOOLS.find((tool) => tool.name === toolName);
  if (!toolDefinition) return null;

  const emptyResult: Record<string, TUniversalValue> = {};

  return {
    id: `tool_${Date.now()}_${Math.random().toString(RANDOM_ID_BASE).substr(2, RANDOM_ID_LENGTH)}`,
    tool: {
      name: toolDefinition.name,
      description: toolDefinition.description,
      execute: async () => emptyResult,
    },
    isActive: false,
    isEnabled: true,
    parameters: {},
    validationErrors: [],
  };
}

export function filterAvailableTools(searchQuery: string) {
  const normalizedQuery = searchQuery.toLowerCase();

  return AVAILABLE_TOOLS.filter(
    (tool) =>
      tool.name.toLowerCase().includes(normalizedQuery) ||
      tool.description.toLowerCase().includes(normalizedQuery),
  );
}
