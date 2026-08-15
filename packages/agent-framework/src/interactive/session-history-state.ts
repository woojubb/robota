import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

export interface IHistoryTrackerState {
  history: IHistoryEntry[];
  memoryEvents: IMemoryEvent[];
  usedMemoryReferences: IMemoryReference[];
  contextReferences: IContextReferenceItem[];
  skillActivationEvents: ISkillActivationEvent[];
}
