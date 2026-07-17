import type { IBaseEventData } from '../event-service/interfaces';

/**
 * Neutral multi-agent orchestration contracts (SELFHOST-001).
 *
 * agent-core OWNS these neutral contracts + the event-type unions the primitives
 * emit; the `agent-framework` layer IMPLEMENTS the mechanism over `agent-executor`'s
 * `ISubagentRunner` port. These are pure interfaces/types — NO runtime, NO class,
 * and NO app-domain identity fields, per the library-neutrality rule. The
 * `orchestration-neutrality` harness scan is the standing floor.
 */

/**
 * The named neutral orchestration primitives. Opaque mechanisms only.
 * P1 implements `sequential`; `parallel`/`handoff` land in P2 and
 * `hierarchical`/`group-chat` in P3 (the union is declared now so the
 * event/result contracts are stable across slices).
 */
export type TOrchestrationPrimitive =
  | 'sequential'
  | 'parallel'
  | 'hierarchical'
  | 'handoff'
  | 'group-chat';

/**
 * A single neutral unit of work in an orchestration run. Opaque — it carries no
 * domain identity; `label` is a plain human-facing string, not an app-domain role.
 */
export interface IOrchestrationStep {
  /** Stable id for the step within the run. */
  id: string;
  /** Neutral human-facing label. */
  label: string;
  /** The subagent type/definition key that executes this step. */
  agentType: string;
  /** The instruction for this step. */
  prompt: string;
  /** Optional model override for this step. */
  model?: string;
  /** Optional per-step tool restriction (reuses existing permission scoping). */
  allowedTools?: string[];
  /** Optional per-step tool denial (reuses existing permission scoping). */
  disallowedTools?: string[];
}

/** The specification for a `sequential` orchestration run. */
export interface ISequentialOrchestrationSpec {
  /** The ordered steps to run one after another. */
  steps: IOrchestrationStep[];
  /**
   * When true (default), each step's prompt is augmented with the previous
   * step's output so a pipeline can thread results forward. When false, each
   * step runs with only its own prompt.
   */
  threadOutput?: boolean;
}

/** The result of one executed step. */
export interface IOrchestrationStepResult {
  /** The step id this result corresponds to. */
  id: string;
  /** The step's output text. */
  output: string;
  /** Optional token usage of the step's subagent run (ANALYTICS-001 shape). */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** The result of an orchestration run. */
export interface IOrchestrationRunResult {
  /** Which primitive produced this result. */
  primitive: TOrchestrationPrimitive;
  /** Per-step results in execution order. */
  steps: IOrchestrationStepResult[];
  /** The aggregate output (for `sequential`, the last step's output). */
  output: string;
}

/**
 * Neutral event payload the orchestration primitives emit over the
 * `IEventService`. Extends the base event shape; adds only neutral,
 * mechanism-level fields.
 */
export interface IOrchestrationEventData extends IBaseEventData {
  /** Which primitive emitted the event. */
  primitive: TOrchestrationPrimitive;
  /** The step id, present for step-scoped events. */
  stepId?: string;
  /** The step index, present for step-scoped events. */
  stepIndex?: number;
  /** A failure reason, present on the `failed` event. */
  reason?: string;
}
