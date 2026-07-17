import { afterEach, describe, expect, it } from 'vitest';

import {
  scriptedSession,
  type ScriptedSessionHarness,
} from '../../testing/scripted-session-harness.js';

/**
 * SELFHOST-002 P2 (TC-04): headless integration of the plan-mode wiring on a REAL InteractiveSession
 * driven by an injected (scripted) provider — no API key. Asserts the artifact/approval round-trip
 * (plan_event lifecycle) and that approval APPLIES the controller's mode decision via
 * `setPermissionMode` (plan → acceptEdits), keeping the existing `plan` mode as the mutation block.
 */
describe('SELFHOST-002 P2 — InteractiveSession plan-mode wiring', () => {
  let harness: ScriptedSessionHarness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  function planSession(): ScriptedSessionHarness {
    return scriptedSession({ turns: [{ text: 'ok' }], permissionMode: 'plan' });
  }

  function mode(h: ScriptedSessionHarness): string {
    return h.session.getSession().getPermissionMode();
  }

  it('setPlan drafts in plan mode (read-only) and emits plan_created', async () => {
    harness = planSession();
    const events: string[] = [];
    harness.session.on('plan_event', (e) => events.push(e.type));

    const plan = await harness.session.setPlan('Ship the feature', ['step a', 'step b']);

    expect(plan.phase).toBe('planning');
    expect(plan.steps.map((s) => s.description)).toEqual(['step a', 'step b']);
    expect(mode(harness)).toBe('plan'); // drafting does NOT unblock mutation
    expect(events).toEqual(['plan_created']);
    expect(harness.session.getPlanState()?.id).toBe(plan.id);
  });

  it('setPlan ESTABLISHES plan mode even when the session was not in plan mode', async () => {
    // The session is CONSTRUCTED in `acceptEdits`; starting a plan must make drafting genuinely
    // read-only regardless of the prior mode — otherwise "read-only until approved" would be false.
    // (Had setPlan not established plan mode, the mode would still read `acceptEdits` here.)
    harness = scriptedSession({ turns: [{ text: 'ok' }], permissionMode: 'acceptEdits' });

    await harness.session.setPlan('Ship it');

    expect(mode(harness)).toBe('plan'); // drafting re-blocks mutation despite the acceptEdits start
  });

  it('approvePlan flips permission mode plan → acceptEdits and emits plan_approved', async () => {
    harness = planSession();
    const events: string[] = [];
    harness.session.on('plan_event', (e) => events.push(e.type));

    await harness.session.setPlan('Ship it');
    const approved = harness.session.approvePlan();

    expect(approved.phase).toBe('executing');
    expect(mode(harness)).toBe('acceptEdits'); // edits now auto-apply; shell still per-call confirmed
    expect(events).toEqual(['plan_created', 'plan_approved']);
  });

  it('revertPlan returns permission mode to plan and emits plan_reverted', async () => {
    harness = planSession();
    const events: string[] = [];
    harness.session.on('plan_event', (e) => events.push(e.type));

    await harness.session.setPlan('Ship it');
    harness.session.approvePlan();
    const reverted = harness.session.revertPlan();

    expect(reverted.phase).toBe('planning');
    expect(mode(harness)).toBe('plan'); // mutation re-blocked
    expect(events).toEqual(['plan_created', 'plan_approved', 'plan_reverted']);
  });
});
