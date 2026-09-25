import { Worker } from 'node:worker_threads';
import { expect, it, vi } from 'vitest';
import { RegexProcessWorker } from '../regex-process-worker.js';
import { IsolatedRegexOperation } from '../isolated-regex-operation.js';

const request = { text: 'abAB', search: '(a)(b)', replacement: '$2$1', flags: 'gi' };
it('preserves native regex flags and capture replacement semantics', async () => {
  expect(await new IsolatedRegexOperation('task', 'node').execute(request)).toEqual({
    ok: true,
    value: 'baBA',
  });
});
it('preserves invalid-regex validation failures', async () => {
  expect(
    await new IsolatedRegexOperation('task', 'node').execute({ ...request, search: '[' }),
  ).toMatchObject({
    ok: false,
    error: { code: 'DAG_VALIDATION_TEXT_REPLACE_INVALID_REGEX', retryable: false },
  });
});
it('does not fall back to inline execution when worker entry fails', async () => {
  const factory = vi.fn(() => {
    throw new Error('entry unavailable');
  });
  expect(await new IsolatedRegexOperation('task', 'node', factory).execute(request)).toMatchObject({
    ok: false,
    error: { code: 'DAG_TASK_ISOLATION_START_FAILED', retryable: false },
  });
  expect(factory).toHaveBeenCalledTimes(1);
});
it('aborts a running regex and joins exit before reporting cancellation', async () => {
  const controller = new AbortController();
  let exited = false;
  const operation = new IsolatedRegexOperation('task', 'node', (source) => {
    const worker = new Worker(source, { eval: true, execArgv: [] });
    worker.on('message', (message) => {
      if (message.type === 'entered') controller.abort();
    });
    worker.on('exit', () => {
      exited = true;
    });
    return worker;
  });
  expect(
    await operation.execute(
      { ...request, text: 'a'.repeat(28) + '!', search: '^(a+)+$' },
      controller.signal,
    ),
  ).toMatchObject({ ok: false, error: { code: 'DAG_TASK_EXECUTION_CANCELLED' } });
  expect(exited).toBe(true);
  await operation.stopAndWait();
});
it('does not start a worker for pre-aborted input', async () => {
  const factory = vi.fn();
  const controller = new AbortController();
  controller.abort();
  expect(
    await new IsolatedRegexOperation('task', 'node', factory).execute(request, controller.signal),
  ).toMatchObject({ ok: false });
  expect(factory).not.toHaveBeenCalled();
});

it('preserves regex semantics and invalid-pattern errors through the process transport', async () => {
  const create = () => new IsolatedRegexOperation('task', 'node', () => new RegexProcessWorker());
  expect(await create().execute(request)).toEqual({ ok: true, value: 'baBA' });
  expect(await create().execute({ ...request, search: '[' })).toMatchObject({
    ok: false,
    error: { code: 'DAG_VALIDATION_TEXT_REPLACE_INVALID_REGEX' },
  });
});
it('joins the process transport after cancelling a running regex', async () => {
  const controller = new AbortController();
  let exited = false;
  const operation = new IsolatedRegexOperation('task', 'node', () => {
    const worker = new RegexProcessWorker();
    worker.on('message', (message) => {
      if (message.type === 'entered') controller.abort();
    });
    worker.once('exit', () => {
      exited = true;
    });
    return worker;
  });
  expect(
    await operation.execute(
      { ...request, text: 'a'.repeat(28) + '!', search: '^(a+)+$' },
      controller.signal,
    ),
  ).toMatchObject({ ok: false });
  expect(exited).toBe(true);
});
it('rejects an oversized request before creating isolation', async () => {
  const factory = vi.fn();
  expect(
    await new IsolatedRegexOperation('task', 'node', factory).execute({
      ...request,
      text: 'é'.repeat(2 * 1024 * 1024),
    }),
  ).toMatchObject({
    ok: false,
    error: { code: 'DAG_TASK_ISOLATION_MESSAGE_LIMIT', retryable: false },
  });
  expect(factory).not.toHaveBeenCalled();
});
it.each(['thread', 'process'])('bounds the returned DTO in the %s transport', async (transport) => {
  const operation =
    transport === 'process'
      ? new IsolatedRegexOperation('task', 'node', () => new RegexProcessWorker())
      : new IsolatedRegexOperation('task', 'node');
  expect(
    await operation.execute({
      text: 'x'.repeat(2000),
      search: 'x',
      flags: 'g',
      replacement: 'y'.repeat(4000),
    }),
  ).toMatchObject({
    ok: false,
    error: { code: 'DAG_TASK_ISOLATION_MESSAGE_LIMIT', retryable: false },
  });
});

it.each(['thread', 'process'])('enforces a trusted smaller output cap in the %s transport', async (transport) => {
  const factory = transport === 'process' ? () => new RegexProcessWorker() : undefined;
  const create = () => new IsolatedRegexOperation('task', 'node', factory, 3);
  expect(await create().execute({ text: 'xx', search: 'x', flags: 'g', replacement: 'é' })).toMatchObject({
    ok: false, error: { code: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED', retryable: false },
  });
  expect(await create().execute({ text: 'x', search: 'x', flags: 'g', replacement: 'é' }))
    .toEqual({ ok: true, value: 'é' });
});

it.each(['thread', 'process'])('preserves substitution and zero-length semantics in the %s transport', async (transport) => {
  const factory = transport === 'process' ? () => new RegexProcessWorker() : undefined;
  for (const sample of [
    { text: 'abc', search: 'b', flags: '', replacement: "$$:$&:$`:$'" },
    { text: 'ab', search: '(a)(b)', flags: '', replacement: '$1/$10/$2' },
    { text: 'abc', search: '(?<part>b)', flags: '', replacement: '$<part>/$<missing>' },
    { text: '😀', search: '(?:)', flags: 'g', replacement: '-' },
    { text: '😀', search: '(?:)', flags: 'gu', replacement: '-' },
    { text: '\ud800x\udc00', search: 'x', flags: '', replacement: '' },
  ]) {
    const expected = sample.text.replace(new RegExp(sample.search, sample.flags), sample.replacement);
    expect(await new IsolatedRegexOperation('task', 'node', factory).execute(sample))
      .toEqual({ ok: true, value: expected });
  }
});
