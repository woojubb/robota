import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const DEFAULT_MCP_RECEIVE_BYTES = 8 * 1024 * 1024;
/** Covers 16 MiB raw bytes even with six-byte JSON escaping, plus framing; selected only by the host. */
export const SKILL_RESOURCE_RECEIVE_BYTES = 128 * 1024 * 1024;
const skillCarriers = new WeakSet<Transport>();

export function enableSkillReceiveBudget(transport: Transport): void {
  skillCarriers.add(transport);
}

export function skillReceiveBudgetEnabled(transport: Transport): boolean {
  return skillCarriers.has(transport);
}
