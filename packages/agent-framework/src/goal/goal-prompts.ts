/**
 * GOAL-001: prompt composition for autonomous objective pursuit.
 *
 * These prompts inject the objective into each goal-driven turn and instruct the agent to use the
 * {@link GOAL_SIGNAL_TOOL_NAME} completion-signal tool. They are deliberately vendor-neutral.
 */

import { GOAL_SIGNAL_TOOL_NAME } from './goal-status-tool.js';

import type { IGoalState } from '@robota-sdk/agent-interface-transport';

const SIGNAL_INSTRUCTION =
  `When you have made as much progress as you can this turn, call \`${GOAL_SIGNAL_TOOL_NAME}\`: ` +
  `use status "satisfied" once the goal is fully achieved, or status "continue" with a short ` +
  `reason describing the remaining work. Do the actual work with your tools first; the signal ` +
  `only reports your assessment.`;

/** The prompt that kicks off goal pursuit (first iteration). */
export function buildGoalStartPrompt(objective: string): string {
  return [
    `You have been assigned an autonomous goal to pursue across multiple turns:`,
    ``,
    `GOAL: ${objective}`,
    ``,
    `Work toward this goal now. ${SIGNAL_INSTRUCTION}`,
  ].join('\n');
}

/** The continuation prompt for each subsequent goal-driven turn. */
export function buildGoalContinuationPrompt(goal: IGoalState): string {
  const last = goal.progress[goal.progress.length - 1];
  const remaining = last?.reason ? `\nMost recent assessment: ${last.reason}` : '';
  return [
    `Continue pursuing the assigned goal (iteration ${goal.iterations + 1} of at most ${goal.maxIterations}).`,
    ``,
    `GOAL: ${goal.objective}${remaining}`,
    ``,
    `Keep going from where you left off. ${SIGNAL_INSTRUCTION}`,
  ].join('\n');
}
