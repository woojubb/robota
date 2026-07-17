import { describe, it, expect } from 'vitest';
import { evaluatePermission } from '@robota-sdk/agent-core';
import { PlanController, type IPlanControllerDeps } from '../plan-controller';

/** Deterministic deps so ids/timestamps are stable in assertions. */
function testDeps(): IPlanControllerDeps {
  let n = 0;
  return { now: () => '2026-07-17T00:00:00.000Z', createId: () => `id-${n++}` };
}

describe('SELFHOST-002 P1 — plan-mode', () => {
  // TC-01: while in `plan` mode, a mutating tool call is denied by the EXISTING gate
  // (MODE_POLICY.plan via evaluatePermission) — not by a new plan-mode-specific gate.
  it('TC-01: plan mode denies mutating tools via the existing permission gate', () => {
    expect(evaluatePermission('Write', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('Edit', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('Bash', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('Shell', {}, 'plan')).toBe('deny');
  });

  // TC-02: read-only tools are permitted during the plan phase.
  it('TC-02: plan mode permits read-only tools', () => {
    expect(evaluatePermission('Read', {}, 'plan')).toBe('auto');
    expect(evaluatePermission('Glob', {}, 'plan')).toBe('auto');
    expect(evaluatePermission('Grep', {}, 'plan')).toBe('auto');
    expect(evaluatePermission('WebFetch', {}, 'plan')).toBe('auto');
  });

  // TC-03 (decision half): the PURE controller returns the approve decision with NO side-effect —
  // it never touches permission mode itself (mirrors GoalController's decision-only unit tests).
  it('TC-03: approve() returns { approve, acceptEdits } with no side-effect', () => {
    const controller = new PlanController(testDeps());
    controller.start('Ship the feature', ['step one', 'step two']);
    controller.requestApproval();
    const decision = controller.approve();

    expect(decision).toEqual({
      action: 'approve',
      nextMode: 'acceptEdits',
      plan: expect.objectContaining({ phase: 'executing', approvedAt: '2026-07-17T00:00:00.000Z' }),
    });
    // Decision-only: the controller carries no session/permission handle to mutate.
    expect(controller.getState()?.phase).toBe('executing');
  });

  // TC-03 (effect half): applying `acceptEdits` (what InteractiveSession does with nextMode) makes
  // Write/Edit auto while Bash/Shell stay per-call `approve` — asserted against the real gate.
  it('TC-03: applying acceptEdits flows edits but keeps shell per-call confirmed', () => {
    expect(evaluatePermission('Write', {}, 'acceptEdits')).toBe('auto');
    expect(evaluatePermission('Edit', {}, 'acceptEdits')).toBe('auto');
    expect(evaluatePermission('Bash', {}, 'acceptEdits')).toBe('approve');
    expect(evaluatePermission('Shell', {}, 'acceptEdits')).toBe('approve');
  });

  it('drives the phase machine planning → awaiting-approval → executing → completed', () => {
    const controller = new PlanController(testDeps());
    const started = controller.start('Objective', ['a']);
    expect(started.phase).toBe('planning');
    expect(started.steps).toEqual([{ id: 'id-0_0', description: 'a', status: 'pending' }]);

    expect(controller.requestApproval().plan.phase).toBe('awaiting-approval');
    expect(controller.approve().plan.phase).toBe('executing');

    const done = controller.complete();
    expect(done).toEqual({
      action: 'revert',
      nextMode: 'plan',
      plan: expect.objectContaining({ phase: 'completed' }),
    });
  });

  it('revert() returns the mode to plan and re-enters planning', () => {
    const controller = new PlanController(testDeps());
    controller.start('Objective');
    controller.requestApproval();
    const decision = controller.revert();
    expect(decision.action).toBe('revert');
    expect(decision.nextMode).toBe('plan');
    expect(controller.getState()?.phase).toBe('planning');
  });

  it('markStep updates a single step status', () => {
    const controller = new PlanController(testDeps());
    controller.start('Objective', ['a', 'b']);
    const updated = controller.markStep('id-0_0', 'done');
    expect(updated.steps.find((s) => s.id === 'id-0_0')?.status).toBe('done');
    expect(updated.steps.find((s) => s.id === 'id-1_1')?.status).toBe('pending');
    expect(() => controller.markStep('nope', 'done')).toThrow(/unknown step id/);
  });

  it('rejects out-of-phase transitions and an empty objective', () => {
    const controller = new PlanController(testDeps());
    expect(() => controller.start('   ')).toThrow(/non-empty/);
    controller.start('Objective');
    expect(() => controller.approve()).toThrow(/awaiting-approval/); // still planning
    expect(() => controller.complete()).toThrow(/executing/);
  });
});
