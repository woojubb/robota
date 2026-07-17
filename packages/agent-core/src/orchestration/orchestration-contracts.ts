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

/** The specification for a `parallel` orchestration run (SELFHOST-001 P2). */
export interface IParallelOrchestrationSpec {
  /** The steps to run concurrently. Each runs with only its own prompt (no threading). */
  steps: IOrchestrationStep[];
  /**
   * Maximum number of steps in flight at once (bounded concurrency). When
   * omitted or `<= 0`, all steps run at once. Steps beyond the bound queue and
   * start as slots free up. Results are returned in the original step order
   * regardless of completion order.
   */
  maxConcurrency?: number;
}

/**
 * The specification for a `handoff` orchestration run (SELFHOST-001 P2).
 *
 * Distinct from `sequential` (a fixed ordered pipeline) and from
 * hierarchical manager-delegation: here loop ownership TRANSFERS between
 * steps dynamically. Control starts at `entryStepId`; after each step, the
 * caller-supplied handoff policy decides which step (if any) receives control
 * next. The step that receives control is threaded the previous step's output.
 */
export interface IHandoffOrchestrationSpec {
  /** The candidate steps control can transfer among, addressed by `id`. */
  steps: IOrchestrationStep[];
  /** The id of the step that receives control first. */
  entryStepId: string;
  /**
   * Maximum number of control transfers before the run is forced to stop (a
   * loop bound guarding a mis-specified policy that never terminates). When
   * omitted, defaults to the step count. Exceeding it fails the run.
   */
  maxHandoffs?: number;
}

/**
 * A single neutral delegation: run the step addressed by `stepId` with `prompt`.
 * The manager-delegation policy returns these to fan work out to worker steps.
 */
export interface IOrchestrationDelegation {
  /** The worker step to run. */
  stepId: string;
  /** The instruction for the delegated worker on this round. */
  prompt: string;
}

/**
 * The specification for a `hierarchical` (manager-delegation) run (SELFHOST-001 P3).
 *
 * A manager step RETAINS control and delegates sub-work to worker steps,
 * collecting their results and optionally iterating — distinct from `handoff`,
 * where control TRANSFERS away. Each round: the manager step runs (threaded the
 * previous round's aggregated worker output), then the caller-supplied
 * delegation policy turns the manager's output into zero or more worker
 * delegations; an empty/`null` plan ends the run.
 */
export interface IHierarchicalOrchestrationSpec {
  /** All steps (the manager and its workers), addressed by `id`. */
  steps: IOrchestrationStep[];
  /** The id of the manager step that delegates. */
  managerStepId: string;
  /**
   * Maximum number of manager rounds before the run is forced to stop (a loop
   * bound guarding a policy that never finishes delegating). When omitted,
   * defaults to the step count. Exceeding it fails the run.
   */
  maxRounds?: number;
}

/**
 * The specification for a `group-chat` (turn-taking) run (SELFHOST-001 P3).
 *
 * Steps take turns; before each turn the caller-supplied policy selects which
 * step speaks next from the running history, `null` ending the run. Each step is
 * threaded the prior turns' outputs. A neutral turn-taking mechanism only — it
 * carries NO app-domain identity fields (TRANS-001), enforced by the standing
 * `orchestration-neutrality` scan.
 */
export interface IGroupChatOrchestrationSpec {
  /** The steps that take turns, addressed by `id`. */
  steps: IOrchestrationStep[];
  /** The id of the step that takes the first turn. When omitted, the first step. */
  firstStepId?: string;
  /**
   * Maximum number of turns before the run is forced to stop (a loop bound
   * guarding a policy that never ends). When omitted, defaults to the step count.
   * Exceeding it fails the run.
   */
  maxTurns?: number;
}

/** The result of one executed step. */
export interface IOrchestrationStepResult {
  /** The step id this result corresponds to. */
  id: string;
  /** The step's output text. */
  output: string;
  /**
   * Optional token usage of the step's subagent run (ANALYTICS-001 shape). Present
   * only when the underlying runner/manager surfaces usage through its result — the
   * default `SubagentManager.wait` does not yet thread it, so this is `undefined`
   * there until that port is extended.
   */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** The result of an orchestration run. */
export interface IOrchestrationRunResult {
  /** Which primitive produced this result. */
  primitive: TOrchestrationPrimitive;
  /**
   * Per-step results — in EXECUTION order for `sequential`/`handoff`/
   * `hierarchical`/`group-chat` (these may repeat a step id when a step runs
   * again — a returned control-holder, a re-run manager, or a later turn), in
   * ORIGINAL step order for `parallel` (regardless of completion order).
   */
  steps: IOrchestrationStepResult[];
  /**
   * The aggregate output. `sequential`/`handoff`/`hierarchical`/`group-chat`
   * return the LAST executed step's output (the end of the pipeline, the final
   * control-holder, the manager's last round, or the last turn); `parallel`
   * returns every step's output joined in original order (blank-line separated),
   * since concurrent steps have no single "last" result.
   */
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
