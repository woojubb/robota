import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BRANCH_OPERATION_EVENT_MATRIX,
  SessionHistoryTracker,
} from '../interactive-session-history-tracker.js';
import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';

import type { IBranchEvent } from '@robota-sdk/agent-interface-session';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function createTracker(): Promise<{
  tracker: SessionHistoryTracker;
  events: IBranchEvent[];
  order: string[];
}> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-020-branch-events-'));
  roots.push(cwd);
  const events: IBranchEvent[] = [];
  const order: string[] = [];
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  const store = new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint branch event test',
    }),
  });
  const tracker = new SessionHistoryTracker(
    cwd,
    access,
    () => 'session-arch-020',
    () => false,
    () => order.push('persist'),
    vi.fn(),
    vi.fn(),
    store,
    (event) => {
      events.push(event);
      order.push(`emit:${event.kind}`);
    },
  );
  return { tracker, events, order };
}

describe('SessionHistoryTracker branch-event operation matrix (ARCH-020)', () => {
  it('classifies every operation explicitly', () => {
    expect(BRANCH_OPERATION_EVENT_MATRIX).toEqual({
      create: 'checkpoint_created',
      fork: 'branch_forked',
      switch: 'branch_switched',
      restore: 'checkpoint_restored',
      rollback: 'checkpoint_rolled_back',
      resume_pointer: 'non_event',
    });
  });

  it('emits the exact post-persistence event for create, restore, fork, switch, and rollback', async () => {
    const { tracker, events, order } = await createTracker();

    await tracker.beginEditCheckpointTurn('first');
    await tracker.finalizeEditCheckpointTurn();
    await tracker.beginEditCheckpointTurn('second');
    await tracker.finalizeEditCheckpointTurn();
    const [first, second] = tracker.listEditCheckpoints();
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await tracker.restoreEditCheckpoint(first!.id);
    await tracker.forkCheckpointBranch(first!.id);
    tracker.switchCheckpointBranch(second!.id);
    await tracker.rollbackEditCheckpoint(first!.id);

    expect(events.map((event) => event.kind)).toEqual([
      'checkpoint_created',
      'checkpoint_created',
      'checkpoint_restored',
      'branch_forked',
      'branch_switched',
      'checkpoint_rolled_back',
    ]);
    for (const [index, item] of order.entries()) {
      if (!item.startsWith('emit:')) continue;
      expect(order[index - 1]).toBe('persist');
    }
    expect(events.every((event) => event.branchId.length > 0)).toBe(true);
    expect(events.at(-1)?.branchId).toBe('main');
  });

  it('classifies resume-pointer hydration as a non-event', async () => {
    const { tracker, events } = await createTracker();
    await tracker.beginEditCheckpointTurn('first');
    await tracker.finalizeEditCheckpointTurn();
    const pointer = tracker.getActiveBranchPointer();
    expect(pointer).toBeDefined();
    const countBeforeHydration = events.length;

    tracker.restoreActiveBranch(pointer);

    expect(events).toHaveLength(countBeforeHydration);
  });
});
