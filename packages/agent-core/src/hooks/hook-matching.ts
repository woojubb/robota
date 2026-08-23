/**
 * Which hooks in a config apply to a given event input.
 *
 * Selection is a separate question from execution: it depends only on the config and the input, has
 * no side effects, and answers the same way whether or not any executor exists. Keeping it out of
 * `hook-runner.ts` leaves that file about dispatch and aggregation.
 */

import type { IHookGroup, IHookInput } from './types.js';

/** Check if a tool name matches a hook group's matcher pattern. */
export function matchesGroup(group: IHookGroup, matcherTarget: string | undefined): boolean {
  // Empty matcher = match everything
  if (!group.matcher) return true;
  if (!matcherTarget) return false;
  try {
    return new RegExp(group.matcher).test(matcherTarget);
  } catch {
    // allow-fallback: invalid regex → fall back to exact string match
    return group.matcher === matcherTarget;
  }
}

export function getMatcherTarget(input: IHookInput): string | undefined {
  if (input.tool_name) return input.tool_name;
  if (input.hook_event_name === 'SubagentStart' || input.hook_event_name === 'SubagentStop') {
    return input.agent_type ?? input.agent_id;
  }
  if (input.hook_event_name === 'SessionEnd') return input.reason;
  return undefined;
}
