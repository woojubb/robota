import { expect, it, vi } from 'vitest';
import { TaskSnapshotBudget } from '../services/task-snapshot-budget.js';

it('holds sibling reservations across awaits and commits them cumulatively', async () => {
  const budget = new TaskSnapshotBudget({ inputBytes: 0, outputBytes: 4 });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = budget.admit('output', '😀', async () => {
    await held;
    return { applied: true };
  });
  const persist = vi.fn(async () => ({ applied: true }));
  expect(await budget.admit('output', 'x', persist)).toMatchObject({ ok: false });
  expect(persist).not.toHaveBeenCalled();
  release();
  expect(await first).toMatchObject({ ok: true });
  expect(await budget.admit('output', 'x', persist)).toMatchObject({ ok: false });
});

it('refunds a definitively rejected commit exactly once and separates input/output', async () => {
  const budget = new TaskSnapshotBudget({ inputBytes: 2, outputBytes: 2 });
  expect(await budget.admit('output', 'é', async () => ({ applied: false }))).toMatchObject({
    ok: true,
    value: { applied: false },
  });
  expect(await budget.admit('output', 'é', async () => ({ applied: true }))).toMatchObject({
    ok: true,
  });
  expect(await budget.admit('input', '{}', async () => ({ applied: true }))).toMatchObject({
    ok: true,
  });
  expect(await budget.admit('output', 'x', async () => ({ applied: true }))).toMatchObject({
    ok: false,
  });
});

it('closes both directions after an ambiguous persistence failure without refunding capacity', async () => {
  const budget = new TaskSnapshotBudget({ inputBytes: 100, outputBytes: 100 });
  await expect(
    budget.admit('output', '{}', async () => {
      throw new Error('uncertain write');
    }),
  ).rejects.toThrow('uncertain write');
  const persist = vi.fn(async () => ({ applied: true }));
  expect(await budget.admit('input', '{}', persist)).toMatchObject({
    ok: false,
    error: { code: 'DAG_TASK_SNAPSHOT_BUDGET_CLOSED', retryable: false },
  });
  expect(await budget.admit('output', '{}', persist)).toMatchObject({ ok: false });
  expect(persist).not.toHaveBeenCalled();
});

it.each([null, undefined, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid supplied limit %s',
  (inputBytes) => {
    // @ts-expect-error Invalid runtime host policy.
    expect(() => new TaskSnapshotBudget({ inputBytes, outputBytes: 1 })).toThrow(RangeError);
  },
);
