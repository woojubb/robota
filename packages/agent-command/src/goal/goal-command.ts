/**
 * GOAL-001: the `/goal` slash command. Assigns an autonomous objective the agent pursues across
 * turns until satisfied or a bound fires. Delegates to the framework-owned goal controller via the
 * command host context; all loop logic lives in agent-framework.
 */

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult, IGoalState } from '@robota-sdk/agent-interface-transport';

export const GOAL_COMMAND_DESCRIPTION =
  'Assign an autonomous goal the agent pursues across turns until satisfied.';

const GOAL_COMMAND_USAGE =
  'Usage:\n  /goal <objective>   assign a goal and pursue it autonomously\n' +
  '  /goal status        show the current goal and progress\n' +
  '  /goal cancel        stop the current goal';

function formatGoalState(goal: IGoalState): string {
  const lines = [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}${goal.stopReason ? ` (${goal.stopReason})` : ''}`,
    `Iterations: ${goal.iterations} / ${goal.maxIterations}`,
  ];
  const last = goal.progress[goal.progress.length - 1];
  if (last?.reason) lines.push(`Latest: ${last.reason}`);
  return lines.join('\n');
}

export async function executeGoalCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const verb = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';

  if (trimmed.length === 0 || verb === 'help') {
    return { message: GOAL_COMMAND_USAGE, success: true };
  }

  if (verb === 'status') {
    const goal = context.getGoalState?.() ?? null;
    return goal
      ? { message: formatGoalState(goal), success: true, data: { status: goal.status } }
      : { message: 'No goal is set.', success: true };
  }

  if (verb === 'cancel' || verb === 'stop') {
    const stopped = context.cancelGoal?.() ?? null;
    return stopped
      ? { message: `Goal cancelled: ${stopped.objective}`, success: true }
      : { message: 'No active goal to cancel.', success: false };
  }

  if (!context.setGoal) {
    return { message: 'Goal pursuit is not available in this session.', success: false };
  }

  let goal: IGoalState;
  try {
    goal = await context.setGoal(trimmed);
  } catch (error) {
    // allow-fallback: surface an invalid-objective error to the user as a failed command result, not a crash
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
  return {
    message: `Goal set — pursuing autonomously (up to ${goal.maxIterations} iterations):\n${goal.objective}`,
    success: true,
    data: { goalId: goal.id },
  };
}
