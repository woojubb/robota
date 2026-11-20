import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, expect, it, vi } from 'vitest';

import { IsolatedGrepSearch } from '../builtins/isolated-grep-search.js';

import type { ChildProcessWithoutNullStreams } from 'node:child_process';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

class ProcessFixture extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 123;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly kill = vi.fn((_signal: NodeJS.Signals) => {
    this.killed = true;
    queueMicrotask(() => {
      this.signalCode = 'SIGKILL';
      this.emit('exit', null, 'SIGKILL');
    });
    return true;
  });
}

function createProcessSearch(child: ProcessFixture): IsolatedGrepSearch {
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcessWithoutNullStreams);
  const versions = process.versions as Record<string, string | undefined>;
  const previous = Object.getOwnPropertyDescriptor(versions, 'bun');
  Object.defineProperty(versions, 'bun', { value: 'test', configurable: true });
  try {
    return new IsolatedGrepSearch('needle');
  } finally {
    if (previous) Object.defineProperty(versions, 'bun', previous);
    else delete versions.bun;
  }
}

afterEach(() => {
  vi.mocked(spawn).mockReset();
});

it('settles a killed search after the child exits even if its pipes never close', async () => {
  const child = new ProcessFixture();
  const search = createProcessSearch(child);
  const pending = search.search('needle', 'document.txt', 0, 'count').catch((error: unknown) => error);
  const stopped = search.stop();
  try {
    const outcome = await Promise.race([
      stopped.then(() => 'stopped'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 300)),
    ]);
    expect(outcome).toBe('stopped');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.stdin.destroyed).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(await pending).toMatchObject({ message: 'Grep search stopped' });
  } finally {
    child.emit('close', null);
    await stopped;
  }
});

it('waits for the killed child to exit before reporting cleanup', async () => {
  const child = new ProcessFixture();
  child.kill.mockImplementationOnce(() => true);
  const search = createProcessSearch(child);
  const stopped = search.stop();
  let finished = false;
  void stopped.then(() => { finished = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(finished).toBe(false);
  child.signalCode = 'SIGKILL';
  child.emit('exit', null, 'SIGKILL');
  await stopped;
  expect(finished).toBe(true);
});

it('settles a stopped search when the child already exited but its pipes remain open', async () => {
  const child = new ProcessFixture();
  const search = createProcessSearch(child);
  child.exitCode = 0;
  child.emit('exit', 0, null);
  const stopped = search.stop();
  try {
    const outcome = await Promise.race([
      stopped.then(() => 'stopped'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 300)),
    ]);
    expect(outcome).toBe('stopped');
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true);
  } finally {
    child.emit('close', 0, null);
    await stopped;
  }
});

it('keeps a normal result that arrives after exit and before the pipes close', async () => {
  const child = new ProcessFixture();
  const search = createProcessSearch(child);
  const result = search.search('needle', 'document.txt', 0, 'count');
  child.exitCode = 0;
  child.emit('exit', 0, null);
  child.stdout.write(`${JSON.stringify({ id: 0, matches: ['document.txt:1'] })}\n`);
  child.emit('close', 0, null);
  expect(await result).toEqual(['document.txt:1']);
  await search.stop();
  expect(child.kill).not.toHaveBeenCalled();
});

it('does not report a refused kill as completed until the child exits', async () => {
  const child = new ProcessFixture();
  child.kill.mockReturnValueOnce(false);
  const search = createProcessSearch(child);
  const stopped = search.stop();
  try {
    const outcome = await Promise.race([
      stopped.then(() => 'stopped'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 300)),
    ]);
    expect(outcome).toBe('still waiting');
  } finally {
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await stopped;
  }
  expect(child.stdout.destroyed).toBe(true);
});

it('waits for a real exit when sending the kill signal throws', async () => {
  const child = new ProcessFixture();
  child.kill.mockImplementationOnce(() => { throw new Error('signal failed'); });
  const search = createProcessSearch(child);
  const stopped = search.stop();
  let finished = false;
  void stopped.then(() => { finished = true; });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
  } finally {
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await stopped;
  }
  expect(finished).toBe(true);
});
