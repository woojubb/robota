export type * from './types';
export type * from './store-types';
export { RoundtableError } from './errors';
export { MemoryConversationStore } from './memory-store';
export { externalParticipant, roundRobin } from './policies';
export { loadRoundtable } from './load';
export { summarizeUsage } from './types';
import { Conversation } from './conversation';
import type { Roundtable, RoundtableOptions } from './types';

export function createRoundtable(options: RoundtableOptions): Roundtable {
  return new Conversation(options);
}
