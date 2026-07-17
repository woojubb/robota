/**
 * SELFHOST-002: explicit plan-mode phase controller.
 *
 * Pure decision logic (no session/permission/IO dependency) so it is unit-testable in isolation —
 * mirroring {@link GoalController}. It owns the plan phase machine (`planning` →
 * `awaiting-approval` → `executing` → `completed`) and RETURNS `{ action, nextMode }` decisions;
 * it NEVER calls `setPermissionMode` itself. `InteractiveSession` applies each `nextMode` via
 * `setPermissionMode`, exactly as it applies `GoalController`'s decisions.
 *
 * The mutation block stays the existing `plan` permission mode (single enforcement point) — this
 * controller only decides WHEN to flip modes: on approval `plan → acceptEdits` (edits auto-apply,
 * shell/Bash stay per-call confirmed per `MODE_POLICY.acceptEdits`), and back to `plan` on revert
 * or completion.
 */

import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IPlanArtifact,
  IPlanStep,
  TPlanStepStatus,
} from '@robota-sdk/agent-interface-transport';

/** An approval decision: flip to `acceptEdits`. */
export type TPlanApproveDecision = {
  action: 'approve';
  nextMode: TPermissionMode;
  plan: IPlanArtifact;
};
/** A revert decision: return the mode to `plan`. */
export type TPlanRevertDecision = {
  action: 'revert';
  nextMode: TPermissionMode;
  plan: IPlanArtifact;
};
/** A no-mode-change decision (e.g. presenting the plan for review). */
export type TPlanContinueDecision = { action: 'continue'; plan: IPlanArtifact };

/** The controller's decision after a plan-phase transition. */
export type TPlanDecision = TPlanApproveDecision | TPlanRevertDecision | TPlanContinueDecision;

/** Injected seams so the controller stays deterministic and testable. */
export interface IPlanControllerDeps {
  now: () => string;
  createId: () => string;
}

const defaultDeps: IPlanControllerDeps = {
  now: () => new Date().toISOString(),
  createId: () => `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
};

export class PlanController {
  private plan: IPlanArtifact | null = null;

  constructor(private readonly deps: IPlanControllerDeps = defaultDeps) {}

  getState(): IPlanArtifact | null {
    return this.plan;
  }

  /**
   * Begin drafting a plan (phase `planning`). Throws on an empty objective. Step descriptions are
   * seeded as `pending` steps with generated ids. Returns the seeded artifact.
   */
  start(objective: string, stepDescriptions: readonly string[] = []): IPlanArtifact {
    const trimmed = objective.trim();
    if (trimmed.length === 0) {
      throw new Error('A plan objective must be a non-empty string.');
    }
    const steps: IPlanStep[] = stepDescriptions.map((description, index) => ({
      id: `${this.deps.createId()}_${index}`,
      description,
      status: 'pending',
    }));
    this.plan = {
      id: this.deps.createId(),
      objective: trimmed,
      steps,
      phase: 'planning',
      createdAt: this.deps.now(),
    };
    return this.plan;
  }

  /** Restore a persisted plan on resume. */
  restore(plan: IPlanArtifact): void {
    this.plan = plan;
  }

  /** Present the drafted plan for review (`planning` → `awaiting-approval`). */
  requestApproval(): TPlanContinueDecision {
    const plan = this.requirePlan();
    if (plan.phase !== 'planning') {
      throw new Error(`requestApproval requires phase "planning", got "${plan.phase}".`);
    }
    this.plan = { ...plan, phase: 'awaiting-approval' };
    return { action: 'continue', plan: this.plan };
  }

  /**
   * Approve the plan (`awaiting-approval` → `executing`). Returns the decision to flip the mode to
   * `acceptEdits`; the controller does NOT apply it. Throws unless awaiting approval.
   */
  approve(): TPlanApproveDecision {
    const plan = this.requirePlan();
    if (plan.phase !== 'awaiting-approval') {
      throw new Error(`approve requires phase "awaiting-approval", got "${plan.phase}".`);
    }
    this.plan = { ...plan, phase: 'executing', approvedAt: this.deps.now() };
    return { action: 'approve', nextMode: 'acceptEdits', plan: this.plan };
  }

  /**
   * Revert to planning, returning the mode back to `plan`. Intentionally has NO phase guard — it is
   * the escape hatch usable from ANY phase (reject while awaiting approval, bail mid-execution, or
   * re-open a completed plan for another cycle). The mode flip is always the safe direction (`→ plan`,
   * which re-blocks mutation), so an any-phase revert can never widen permissions.
   */
  revert(): TPlanRevertDecision {
    const plan = this.requirePlan();
    this.plan = { ...plan, phase: 'planning' };
    return { action: 'revert', nextMode: 'plan', plan: this.plan };
  }

  /** Finish the plan (`executing` → `completed`), reverting the mode to `plan` for the next cycle. */
  complete(): TPlanRevertDecision {
    const plan = this.requirePlan();
    if (plan.phase !== 'executing') {
      throw new Error(`complete requires phase "executing", got "${plan.phase}".`);
    }
    this.plan = { ...plan, phase: 'completed' };
    return { action: 'revert', nextMode: 'plan', plan: this.plan };
  }

  /** Update one step's status (todo tracking). Throws on an unknown step id (surfaces caller bugs). */
  markStep(stepId: string, status: TPlanStepStatus): IPlanArtifact {
    const plan = this.requirePlan();
    if (!plan.steps.some((step) => step.id === stepId)) {
      throw new Error(`markStep: unknown step id "${stepId}".`);
    }
    this.plan = {
      ...plan,
      steps: plan.steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
    };
    return this.plan;
  }

  private requirePlan(): IPlanArtifact {
    if (!this.plan) throw new Error('No active plan. Call start() first.');
    return this.plan;
  }
}
