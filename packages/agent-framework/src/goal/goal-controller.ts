/**
 * GOAL-001: autonomous objective-pursuit controller.
 *
 * Pure decision logic (no session/IO dependency) so it is unit-testable in isolation. It owns the
 * goal state machine: it reads the deterministic completion signal from a finished turn, advances
 * the goal, and decides whether to continue (with a continuation prompt) or stop (with a reason).
 *
 * Stop conditions, all mandatory: explicit `satisfied` signal, max-iterations (turn budget),
 * no-progress convergence guard (consecutive idle turns), and user cancellation.
 */

import { buildGoalStartPrompt, buildGoalContinuationPrompt } from './goal-prompts.js';
import { GOAL_SIGNAL_TOOL_NAME } from './goal-status-tool.js';

import type {
  IExecutionResult,
  IGoalState,
  IToolSummary,
  TGoalStopReason,
} from '@robota-sdk/agent-interface-transport';

export const DEFAULT_GOAL_MAX_ITERATIONS = 25;
export const DEFAULT_GOAL_NO_PROGRESS_LIMIT = 2;

/** Parsed structured completion signal emitted by the agent via the goal-status tool. */
export interface IGoalSignal {
  status: 'continue' | 'satisfied';
  reason: string;
}

/** The controller's decision after a goal-driven turn completes. */
export type TGoalDecision =
  | { action: 'continue'; prompt: string; goal: IGoalState }
  | { action: 'stop'; reason: TGoalStopReason; goal: IGoalState };

/** Options for {@link GoalController.start}. */
export interface IGoalStartOptions {
  maxIterations?: number;
  noProgressLimit?: number;
}

/** Injected seams so the controller stays deterministic and testable. */
export interface IGoalControllerDeps {
  now: () => string;
  createId: () => string;
}

const defaultDeps: IGoalControllerDeps = {
  now: () => new Date().toISOString(),
  createId: () => `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
};

function parseSignalArgs(args: string): IGoalSignal | null {
  let parsed: { status?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(args) as { status?: unknown; reason?: unknown };
  } catch {
    // allow-fallback: malformed args → treat as "no signal" so the loop falls through to its progress/iteration guards
    return null;
  }
  const status = parsed.status === 'satisfied' ? 'satisfied' : 'continue';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  return { status, reason };
}

/**
 * Read the structured completion signal from a finished turn's tool summaries. Returns the LAST
 * `report_goal_status` call's validated payload, or `null` when the agent did not signal. The
 * payload is schema-validated at the tool layer, so this is deterministic — never prose parsing.
 */
export function extractGoalSignal(toolSummaries: readonly IToolSummary[]): IGoalSignal | null {
  for (let i = toolSummaries.length - 1; i >= 0; i--) {
    const summary = toolSummaries[i];
    if (!summary || summary.name !== GOAL_SIGNAL_TOOL_NAME) continue;
    return parseSignalArgs(summary.args);
  }
  return null;
}

function countNonSignalToolCalls(toolSummaries: readonly IToolSummary[]): number {
  return toolSummaries.filter((s) => s.name !== GOAL_SIGNAL_TOOL_NAME).length;
}

export class GoalController {
  private goal: IGoalState | null = null;
  private consecutiveIdleTurns = 0;
  private noProgressLimit = DEFAULT_GOAL_NO_PROGRESS_LIMIT;

  constructor(private readonly deps: IGoalControllerDeps = defaultDeps) {}

  getState(): IGoalState | null {
    return this.goal;
  }

  isActive(): boolean {
    return this.goal?.status === 'active';
  }

  /**
   * Begin pursuing a new goal. Throws on an empty objective. Returns the seeded state and the
   * first-turn prompt the caller should submit.
   */
  start(objective: string, options: IGoalStartOptions = {}): { goal: IGoalState; prompt: string } {
    const trimmed = objective.trim();
    if (trimmed.length === 0) {
      throw new Error('A goal objective must be a non-empty string.');
    }
    const maxIterations =
      options.maxIterations && options.maxIterations > 0
        ? Math.floor(options.maxIterations)
        : DEFAULT_GOAL_MAX_ITERATIONS;
    this.noProgressLimit =
      options.noProgressLimit && options.noProgressLimit > 0
        ? Math.floor(options.noProgressLimit)
        : DEFAULT_GOAL_NO_PROGRESS_LIMIT;
    this.consecutiveIdleTurns = 0;
    this.goal = {
      id: this.deps.createId(),
      objective: trimmed,
      status: 'active',
      iterations: 0,
      maxIterations,
      startedAt: this.deps.now(),
      progress: [],
    };
    return { goal: this.goal, prompt: buildGoalStartPrompt(trimmed) };
  }

  /** Restore a persisted goal on resume. Only an `active` goal resumes pursuit. */
  restore(goal: IGoalState, noProgressLimit = DEFAULT_GOAL_NO_PROGRESS_LIMIT): void {
    this.goal = goal.status === 'active' ? goal : null;
    this.noProgressLimit = noProgressLimit;
    this.consecutiveIdleTurns = 0;
  }

  /** User-requested cancellation. Returns the stopped state, or `null` when no goal is active. */
  cancel(): IGoalState | null {
    if (!this.goal || this.goal.status !== 'active') return null;
    this.goal = { ...this.goal, status: 'stopped', stopReason: 'cancelled' };
    return this.goal;
  }

  /**
   * Advance the goal after a goal-driven turn completes. Returns the next decision, or `null`
   * when no goal is active (the caller should ignore non-goal turns).
   */
  onTurnComplete(result: IExecutionResult): TGoalDecision | null {
    if (!this.goal || this.goal.status !== 'active') return null;

    const signal = extractGoalSignal(result.toolSummaries);
    const iteration = this.goal.iterations + 1;
    this.goal = {
      ...this.goal,
      iterations: iteration,
      progress: [
        ...this.goal.progress,
        { iteration, signal: signal?.status ?? 'continue', reason: signal?.reason ?? '' },
      ],
    };

    if (signal?.status === 'satisfied') {
      return this.stop('satisfied');
    }

    const didWork = countNonSignalToolCalls(result.toolSummaries) > 0;
    this.consecutiveIdleTurns = didWork ? 0 : this.consecutiveIdleTurns + 1;
    if (this.consecutiveIdleTurns >= this.noProgressLimit) {
      return this.stop('no-progress');
    }

    if (iteration >= this.goal.maxIterations) {
      return this.stop('max-iterations');
    }

    return { action: 'continue', prompt: buildGoalContinuationPrompt(this.goal), goal: this.goal };
  }

  private stop(reason: TGoalStopReason): TGoalDecision {
    const status = reason === 'satisfied' ? 'satisfied' : 'stopped';
    this.goal = { ...this.goal!, status, stopReason: reason };
    return { action: 'stop', reason, goal: this.goal };
  }
}
