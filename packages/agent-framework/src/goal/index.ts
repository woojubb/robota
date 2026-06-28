/**
 * GOAL-001: autonomous objective-pursuit loop.
 *
 * Public surface of the goal module: the completion-signal tool, the pure decision controller,
 * and the prompt builders. Goal state contract types (`IGoalState`, `IGoalEvent`, …) live in
 * `@robota-sdk/agent-interface-transport` (the persistence/transport SSOT).
 */

export {
  GoalController,
  extractGoalSignal,
  DEFAULT_GOAL_MAX_ITERATIONS,
  DEFAULT_GOAL_NO_PROGRESS_LIMIT,
  type IGoalSignal,
  type TGoalDecision,
  type IGoalStartOptions,
  type IGoalControllerDeps,
} from './goal-controller.js';

export { createGoalStatusTool, GOAL_SIGNAL_TOOL_NAME } from './goal-status-tool.js';

export { buildGoalStartPrompt, buildGoalContinuationPrompt } from './goal-prompts.js';
