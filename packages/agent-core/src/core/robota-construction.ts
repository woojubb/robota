/**
 * What `Robota`'s constructor builds that is more than a `new` — kept beside `robota-initializer`
 * for the reason that file exists: the class file sits at its size ceiling.
 */

import { Tools } from '../managers/tool-manager';
import { resolveToolSearchMode } from '../services/tool-search-policy';

import type { IAgentConfig } from '../interfaces/agent';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

/** The conversation this agent owns: the configured id, or a fresh one. */
export function createConversationId(config: IAgentConfig): string {
  return (
    config.conversationId ||
    `conv_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`
  );
}

/**
 * The tool manager, given the ONE policy source it needs (CLI-1990).
 *
 * The manager owns the residency state — which deferred tools are loaded — and asks this resolver
 * whether deferral is engaged on every projection. `readConfig` is read each time rather than
 * captured once, so `updateConfiguration` and `setModel` are reflected by the next round without
 * re-wiring; the deferrable set is the manager's own registry, which is why the closure closes over
 * the instance it is building.
 */
export function createConfiguredTools(readConfig: () => IAgentConfig): Tools {
  const tools: Tools = new Tools({
    resolveToolSearchMode: () => {
      const config = readConfig();
      return resolveToolSearchMode(config, config.defaultModel.model, tools.getTools());
    },
  });
  return tools;
}
