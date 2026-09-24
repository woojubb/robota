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

it('counts escaped controls, quotes, and Unicode by encoded UTF-8 bytes', async () => {
  const value = { text: '😀\n"\u0000é\ud800' };
  const exact = JSON.stringify(value);
  const bytes = Buffer.byteLength(exact, 'utf8');
  const persist = vi.fn(async (snapshot: string) => {
    expect(snapshot).toBe(exact);
    return { applied: true };
  });
  expect(await new TaskSnapshotBudget({ inputBytes: bytes - 1, outputBytes: 0 })
    .admitValue('input', value, persist)).toMatchObject({ ok: false });
  expect(persist).not.toHaveBeenCalled();
  expect(await new TaskSnapshotBudget({ inputBytes: bytes, outputBytes: 0 })
    .admitValue('input', value, persist)).toMatchObject({ ok: true });
});

it('never calls data-defined toJSON while bounding a large value', async () => {
  const toJSON = vi.fn(() => 'wrong');
  const persist = vi.fn(async () => ({ applied: true }));
  const budget = new TaskSnapshotBudget({ inputBytes: 32, outputBytes: 0 });
  expect(await budget.admitValue('input', { toJSON, large: 'x'.repeat(100_000) }, persist))
    .toMatchObject({ ok: false, error: { code: 'DAG_TASK_SNAPSHOT_BUDGET_EXCEEDED' } });
  expect(toJSON).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
});

it('reserves run definition and input against sibling task admission until persistence settles', async () => {
  const definition = { config: 'x'.repeat(30) };
  const input = { value: 'y' };
  const bytes = Buffer.byteLength(JSON.stringify(definition) + JSON.stringify(input));
  const budget = new TaskSnapshotBudget({ inputBytes: bytes, outputBytes: 0 });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = budget.admitRun(definition, input, async () => { await held; });
  const persist = vi.fn(async () => ({ applied: true }));
  expect(await budget.admitValue('input', {}, persist)).toMatchObject({ ok: false });
  expect(persist).not.toHaveBeenCalled();
  release();
  expect(await first).toMatchObject({ ok: true });
});

it('admits valid JSON nested beyond 256 levels when its encoded bytes fit', async () => {
  let value: unknown = 'leaf';
  for (let depth = 0; depth < 257; depth++) value = { child: value };
  const snapshot = JSON.stringify(value);
  const persist = vi.fn(async (encoded: string) => {
    expect(encoded).toBe(snapshot);
    return { applied: true };
  });
  const budget = new TaskSnapshotBudget({ inputBytes: Buffer.byteLength(snapshot), outputBytes: 0 });
  expect(await budget.admitValue('input', value, persist)).toMatchObject({ ok: true });
  expect(persist).toHaveBeenCalledOnce();
});
