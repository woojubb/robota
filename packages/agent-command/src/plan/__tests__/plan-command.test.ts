import { describe, it, expect, vi } from 'vitest';

import { executePlanCommand } from '../plan-command.js';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { IPlanArtifact } from '@robota-sdk/agent-interface-transport';

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

function host(overrides: Partial<ICommandHostContext> = {}): ICommandHostContext {
  return overrides as unknown as ICommandHostContext;
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

  it('reports unavailability when the session cannot plan', async () => {
    const result = await executePlanCommand(host({}), 'do a thing');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not available');
  });
});
