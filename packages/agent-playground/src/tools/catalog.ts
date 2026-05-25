import type { IEventService, IAIProvider, ITool } from '@robota-sdk/agent-core';
import { CURRENT_TIME_META, createCurrentTimeTool } from './current-time/index';
import type { IPlaygroundToolMeta } from './types';

export type { IPlaygroundToolMeta } from './types';

// Static tool catalog (UI-only metadata)
export function getPlaygroundToolCatalog(): IPlaygroundToolMeta[] {
  return [CURRENT_TIME_META];
}

// Static tool registry (id -> factory with eventService and aiProviders injection)
export const ToolRegistry: Record<
  string,
  (eventService: IEventService, aiProviders: IAIProvider[]) => ITool
> = {
  'current-time': (_eventService: IEventService) => createCurrentTimeTool(),
};
