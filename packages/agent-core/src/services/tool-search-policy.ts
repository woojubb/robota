/**
 * The threshold policy that decides whether deferral engages (CLI-1990 § Solution 3).
 *
 * "On by default" means default-on as a THRESHOLD policy, never unconditional deferral. Anthropic's
 * own guidance is that standard tool calling is the better fit under ten tools, and its SDK engages
 * search when the deferrable definitions reach a tenth of the model's context window; OpenAI and
 * Gemini document comparable bands. So at the ten resident built-ins of today's tree the answer is
 * `'off'` and nothing regresses, and when a tool set crosses the band — MCP servers arriving, say —
 * it switches itself on with no flag day. An explicit setting wins over both.
 *
 * Only DEFERRABLE schemas are measured against the window: deferral cannot save what is resident,
 * so counting it would engage the mechanism for a saving it cannot make.
 */

import { estimateToolSchemaTokens } from '../context/estimation';
import { getModelContextWindow } from '../context/models';
import { isDeferredTool } from '../tool-registry/tool-residency';

import type { IToolSchema } from '../interfaces/tool-schema';
import type { TToolSearchMode, TToolSearchSetting } from '../interfaces/tool-search';

/** Deferral engages when MORE than this many deferrable tools are registered. */
export const TOOL_SEARCH_DEFERRABLE_COUNT_THRESHOLD = 15;

/** …or when the deferrable schemas' estimated tokens reach this share of the model's context window. */
export const TOOL_SEARCH_CONTEXT_WINDOW_SHARE = 0.1;

/** What the policy reads from an agent config — `IAgentConfig` satisfies it. */
export interface IToolSearchPolicyConfig {
  readonly toolSearch?: TToolSearchSetting;
}

/**
 * Whether deferred schemas are withheld from the model's tool list.
 *
 * Evaluated per read, never cached: the inputs are the config, the model and the registered set,
 * and each of them can change between rounds through the agent's own seams.
 */
export function resolveToolSearchMode(
  config: IToolSearchPolicyConfig,
  modelId: string,
  tools: readonly IToolSchema[],
): TToolSearchMode {
  const setting = config.toolSearch ?? 'auto';
  if (setting !== 'auto') return setting;
  const deferrable = tools.filter(isDeferredTool);
  // Decided before any window lookup, so a tree with nothing deferrable never asks about a model it
  // may not have registered metadata for.
  if (deferrable.length === 0) return 'off';
  if (deferrable.length > TOOL_SEARCH_DEFERRABLE_COUNT_THRESHOLD) return 'on';
  const share = estimateToolSchemaTokens(deferrable) / getModelContextWindow(modelId);
  return share >= TOOL_SEARCH_CONTEXT_WINDOW_SHARE ? 'on' : 'off';
}
