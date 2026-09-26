import { describe, expect, it } from 'vitest';

import { FRAMEWORK_TOOL_PERMISSION_PROFILES } from '../tool-permission-profiles.js';

/**
 * CORE-049 (issue #2350) — the kind is declared WITH the key for every tool this package defines,
 * so a missing declaration is red here rather than a silent fallback to the string glob.
 */
describe('CORE-049 — this package declares the kind of every argument it scopes patterns to', () => {
  it('command tools are command-kind', () => {
    for (const tool of ['BackgroundProcess', 'ExecuteCommand']) {
      expect(FRAMEWORK_TOOL_PERMISSION_PROFILES[tool]?.argument?.kind, tool).toBe('command');
    }
  });
});

/**
 * #3201 — a session's own signal tools change nothing: they record the agent's assessment for the
 * goal or loop that asked for it. An unclassified tool asks in `default` mode and is refused in
 * `plan` mode, which made `/goal` prompt every turn and never able to finish in plan mode.
 */
describe('#3201 — the goal and loop signal tools are inspections', () => {
  it('neither prompts in default mode nor is refused in plan mode', async () => {
    const { evaluatePermission } = await import('@robota-sdk/agent-core');
    await import('../../goal/goal-status-tool.js');
    await import('../../interactive/session-loop-decision-tool.js');
    for (const tool of ['report_goal_status', 'report_loop_decision']) {
      expect(FRAMEWORK_TOOL_PERMISSION_PROFILES[tool]?.riskClass, tool).toBe('inspect');
      expect(evaluatePermission(tool, { status: 'continue' }, 'default'), tool).toBe('auto');
      expect(evaluatePermission(tool, { status: 'continue' }, 'plan'), tool).not.toBe('deny');
    }
  });
});
