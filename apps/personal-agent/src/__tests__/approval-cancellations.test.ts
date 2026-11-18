import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoalBook } from '@robota-sdk/agent-product/personal';
import { expect, it, vi } from 'vitest';

import { createApprovalCancellations } from '../approval-cancellations.js';
import { createApprovalRegistry } from '../approvals.js';
import { createSharedFeedStore } from '../feed-store.js';
import { startHarness } from './harness.js';

it('recovers an answer interrupted after its feed write and before handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'approval-interrupted-'));
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
  const resolvePermission = vi.fn();
  let answer: Promise<unknown> | undefined;
  let restarted: Awaited<ReturnType<typeof startHarness>> | undefined;
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
    answer = approvals.answer(item.id, true).catch((error: unknown) => error);
    await written;
    expect(cancellations.list()[0]?.phase).toBe('pending');
    await approvals.restore();
    expect((await book.feedItem(item.id))?.approval?.state).toBe('approved');

    // A new host sees the durable in-flight answer that the stopped process left behind.
    restarted = await startHarness({ stateDir: root });
    expect((await restarted.capabilities.goals.feedItem(item.id))?.approval?.state).toBe('expired');
    const stopping = approvals.shutdown();
    release();
    await stopping;
    expect(await answer).toBeInstanceOf(Error);
    expect(resolvePermission).not.toHaveBeenCalledWith('prompt', true);
  } finally {
    release();
    await Promise.allSettled(answer === undefined ? [] : [answer]);
    await restarted?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

it('preserves an authorized answer when its intent cleanup needs a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'approval-authorized-'));
  const book = new GoalBook({ store: createSharedFeedStore(root) });
  const cancellations = createApprovalCancellations(root);
  const approvals = createApprovalRegistry(book, undefined, undefined, cancellations);
  const resolvePermission = vi.fn();
  let restarted: Awaited<ReturnType<typeof startHarness>> | undefined;
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
      recordAnswer: async () => book.setApproval(item.id, 'approved'),
    });
    const finish = vi.spyOn(cancellations, 'finish').mockImplementationOnce(() => {
      throw new Error('cleanup unavailable');
    });
    expect((await approvals.answer(item.id, true)).approval?.state).toBe('approved');
    expect(resolvePermission).toHaveBeenCalledWith('prompt', true);
    expect(cancellations.list()[0]?.phase).toBe('authorized');
    finish.mockRestore();
    restarted = await startHarness({ stateDir: root });
    expect((await restarted.capabilities.goals.feedItem(item.id))?.approval?.state).toBe(
      'approved',
    );
    expect(cancellations.list()).toEqual([]);
  } finally {
    await restarted?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

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
