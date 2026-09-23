import { join } from 'node:path';

/** Product-owned agent definition locations, in discovery priority order. */
export const ROBOTA_AGENT_DEFINITION_ROOTS: readonly string[] = [
  join('.robota', 'agents'),
  join('.agents', 'agents'),
  join('.claude', 'agents'),
];
