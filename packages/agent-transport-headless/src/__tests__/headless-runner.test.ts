import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IExecutionResult } from '@robota-sdk/agent-sdk';
import { createHeadlessRunner } from '../headless-runner.js';

function createMockSession(behavior: 'complete' | 'interrupted' | 'error', response = '') {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    submit: vi.fn(async () => {
      if (behavior === 'complete') {
        const result: IExecutionResult = {
          response,
          history: [],
          toolSummaries: [],
          contextState: {} as IExecutionResult['contextState'],
        };
        for (const h of listeners.get('complete') ?? []) {
          h(result);
        }
      } else if (behavior === 'interrupted') {
        const result: IExecutionResult = {
          response,
          history: [],
          toolSummaries: [],
          contextState: {} as IExecutionResult['contextState'],
        };
        for (const h of listeners.get('interrupted') ?? []) {
          h(result);
        }
      } else if (behavior === 'error') {
        for (const h of listeners.get('error') ?? []) {
          h(new Error('test error'));
        }
      }
    }),
    getSession: vi.fn(() => ({ getSessionId: () => 'test-session-id' })),
  } as unknown as InteractiveSession;
}

describe('createHeadlessRunner (text format)', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('writes response + newline to stdout and returns exit code 0 on complete', async () => {
    const session = createMockSession('complete', 'Hello, world!');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('Hello, world!\n');
  });

  it('writes partial response on interrupted and returns exit code 0', async () => {
    const session = createMockSession('interrupted', 'partial output');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('partial output\n');
  });

  it('does not write to stdout on interrupted with empty response', async () => {
    const session = createMockSession('interrupted', '');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('returns exit code 1 on error', async () => {
    const session = createMockSession('error');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(1);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('passes the prompt to session.submit', async () => {
    const session = createMockSession('complete', 'ok');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });

    await runner.run('my prompt');

    expect(session.submit).toHaveBeenCalledWith('my prompt');
  });
});

describe('createHeadlessRunner (json format)', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('json format outputs { type, result, session_id, subtype: success }', async () => {
    const session = createMockSession('complete', 'JSON response');
    const runner = createHeadlessRunner({ session, outputFormat: 'json' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: 'JSON response',
      session_id: 'test-session-id',
      subtype: 'success',
    });
  });

  it('json format outputs subtype error on failure', async () => {
    const session = createMockSession('error');
    const runner = createHeadlessRunner({ session, outputFormat: 'json' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(1);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: '',
      session_id: 'test-session-id',
      subtype: 'error',
    });
  });

  it('json format outputs subtype success with partial response on interrupted', async () => {
    const session = createMockSession('interrupted', 'partial');
    const runner = createHeadlessRunner({ session, outputFormat: 'json' });

    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: 'partial',
      session_id: 'test-session-id',
      subtype: 'success',
    });
  });
});
