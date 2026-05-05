import type { IAIProvider, IEventService } from '@robota-sdk/agent-core';
import { FunctionTool } from '@robota-sdk/agent-tools';

import type { IToolCard } from './types';
import { ToolRegistry } from '../../../tools/catalog';

type ToolFactory = (eventService: IEventService, aiProviders: IAIProvider[]) => FunctionTool;

export function createToolFromCard(
  card: IToolCard,
  eventService: IEventService,
  aiProviders: IAIProvider[],
): FunctionTool {
  const typedToolRegistry = ToolRegistry as Record<string, ToolFactory | undefined>;
  const factory = typedToolRegistry[card.id];

  if (typeof factory !== 'function') {
    throw new Error(`Unknown tool id: ${card.id}`);
  }

  return factory(eventService, aiProviders);
}
