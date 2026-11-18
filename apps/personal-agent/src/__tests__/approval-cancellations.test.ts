import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoalBook } from '@robota-sdk/agent-product/personal';
import { expect, it, vi } from 'vitest';

import { createApprovalCancellations } from '../approval-cancellations.js';
import { createApprovalRegistry } from '../approvals.js';
import { createSharedFeedStore } from '../feed-store.js';
import { startHarness } from './harness.js';

it('recovers a cancellation that could not update the feed during shutdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'approval-cancellation-'));
  const book = new GoalBook({ store: createSharedFeedStore(root) });
  const cancellations = createApprovalCancellations(root);
  const approvals = createApprovalRegistry(book, undefined, undefined, cancellations);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const written = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let answer: Promise<unknown> | undefined;
  let stopping: Promise<void> | undefined;
  let restarted: Awaited<ReturnType<typeof startHarness>> | undefined;
  const resolvePermission = vi.fn();
  try {
    const item = await book.post({
      kind: 'approval',
      title: 'Action',
      body: '',
      approval: { tool: 'ConnectorAct', detail: 'Send the message', state: 'pending' },
    });
    approvals.register(item, {
      session: { resolvePermission },
      promptId: 'prompt',
      recordAnswer: async () => {
        const recorded = await book.setApproval(item.id, 'approved');
        reached();
        await gate;
        return recorded;
      },
    });
    const unavailable = vi
      .spyOn(book, 'cancelApproval')
      .mockRejectedValue(new Error('feed locked'));
    answer = approvals.answer(item.id, true).catch((error: unknown) => error);
    await written;
    stopping = approvals.shutdown();
    expect(cancellations.list()).toHaveLength(1);
    expect(statSync(join(root, 'approval-cancellations', `${item.id}.json`)).mode & 0o777).toBe(
      0o600,
    );
    release();
    await stopping;
    expect(await answer).toBeInstanceOf(Error);
    expect(resolvePermission).not.toHaveBeenCalledWith('prompt', true);
    expect((await book.feedItem(item.id))?.approval?.state).toBe('approved');
    unavailable.mockRestore();

    restarted = await startHarness({ stateDir: root });
    expect((await restarted.capabilities.goals.feedItem(item.id))?.approval?.state).toBe('expired');
    expect(cancellations.list()).toEqual([]);
  } finally {
    release();
    await Promise.allSettled([
      ...(answer === undefined ? [] : [answer]),
      ...(stopping === undefined ? [] : [stopping]),
    ]);
    await restarted?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
