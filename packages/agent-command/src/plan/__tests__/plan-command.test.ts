import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';

import { executePlanCommand } from '../plan-command.js';

import type { IPlanArtifact } from '@robota-sdk/agent-interface-session';
import {
  createTestCommandHost,
  type ICreateTestCommandHostOptions,
} from '@robota-sdk/agent-framework/testing';

function plan(overrides: Partial<IPlanArtifact> = {}): IPlanArtifact {
  return {
    id: 'p1',
    objective: 'ship the feature',
    steps: [{ id: 'p1_0', description: 'draft the change', status: 'pending' }],
    phase: 'planning',
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function host(overrides: ICreateTestCommandHostOptions['overrides'] = {}) {
  // ARCH-029: the partial is now an OVERRIDE over a conformant host, not a cast that turns the
  // check off. A fixture that names three members no longer claims to satisfy 46.
  return createTestCommandHost({ overrides });
}

describe('executePlanCommand (SELFHOST-002 /plan)', () => {
  it('drafts a plan from the objective text', async () => {
    const setPlan = vi.fn().mockResolvedValue(plan());
    const result = await executePlanCommand(host({ setPlan }), 'ship the feature');
    expect(setPlan).toHaveBeenCalledWith('ship the feature');
    expect(result.success).toBe(true);
    expect(result.message).toContain('/plan approve');
    expect(result.data).toMatchObject({ planId: 'p1' });
  });

  it('renders the current plan on "status"', async () => {
    const result = await executePlanCommand(
      host({ getPlanState: () => plan({ phase: 'awaiting-approval' }) }),
      'status',
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('ship the feature');
    expect(result.message).toContain('Phase: awaiting-approval');
    expect(result.message).toContain('1. [pending] draft the change');
  });

  it('reports when no plan is active', async () => {
    const result = await executePlanCommand(host({ getPlanState: () => null }), 'status');
    expect(result.message).toBe('No plan is active.');
  });

  it('approves via approvePlan and reports the executing phase', async () => {
    const approvePlan = vi.fn().mockReturnValue(plan({ phase: 'executing' }));
    const result = await executePlanCommand(
      host({ getPlanState: () => plan({ phase: 'awaiting-approval' }), approvePlan }),
      'approve',
    );
    expect(approvePlan).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain('edits will auto-apply');
    expect(result.data).toMatchObject({ phase: 'executing' });
  });

  it('rejects approve when no plan exists', async () => {
    const approvePlan = vi.fn();
    const result = await executePlanCommand(
      host({ getPlanState: () => null, approvePlan }),
      'approve',
    );
    expect(approvePlan).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain('No plan to approve');
  });

  it('surfaces an out-of-phase approval error as a failed result', async () => {
    const approvePlan = vi.fn(() => {
      throw new Error('approve requires phase "awaiting-approval", got "executing".');
    });
    const result = await executePlanCommand(
      host({ getPlanState: () => plan({ phase: 'executing' }), approvePlan }),
      'approve',
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('awaiting-approval');
  });

  it('reverts via revertPlan', async () => {
    const revertPlan = vi.fn().mockReturnValue(plan({ phase: 'planning' }));
    const result = await executePlanCommand(
      host({ getPlanState: () => plan({ phase: 'executing' }), revertPlan }),
      'revert',
    );
    expect(revertPlan).toHaveBeenCalled();
    expect(result.message).toContain('edits are blocked again');
  });

  it('shows usage on empty args or help', async () => {
    const result = await executePlanCommand(host({}), '');
    expect(result.message).toContain('Usage:');
    expect(result.message).toContain('/plan approve');
  });

  it('ARCH-029 TC-09: the availability guards are gone from the source', () => {
    // Review caught the first attempt at this case: it re-asserted "No plan is active." for a
    // null-returning host, which `reports when no plan is active` above already pins with a
    // STRONGER matcher, over an override that is the double's own default. It would have passed
    // unchanged on the pre-fix code — a check that cannot fail on the thing it names.
    //
    // Stated plainly instead: there is NO behavioural test for this deletion, because there was no
    // behaviour. `if (!context.setPlan) return 'Plan mode is not available in this session.'` was
    // already unreachable — the members are unconditionally implemented on `InteractiveSession`
    // over always-constructed controllers, and it is the only host (`implements` is compiler-
    // checked, casts are ratcheted at 0, and heritage-clause aliases are counted since this
    // review). Required-ness makes the branch unreachable for the type checker too. So what can be
    // pinned is that the branch is not in the file, and that is what this asserts.
    const source = readFileSync(
      fileURLToPath(new URL('../plan-command.js', import.meta.url)).replace(/\.js$/, '.ts'),
      'utf8',
    );

    expect(source).not.toContain('is not available in this session');
    expect(source).not.toMatch(/if \(!context\.[a-zA-Z]+\)/);
  });
});
