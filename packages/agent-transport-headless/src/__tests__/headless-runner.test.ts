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

describe('createHeadlessRunner (stream-json format)', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('stream-json emits content_block_delta events and final result', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(async () => {
        for (const h of listeners.get('text_delta') ?? []) {
          h('Hello');
          h(' world');
        }
        for (const h of listeners.get('complete') ?? []) {
          h({ response: 'Hello world', history: [], toolSummaries: [], contextState: {} });
        }
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
    } as unknown as InteractiveSession;

    const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(0);

    const lines = stdoutWriteSpy.mock.calls.map((call) => (call as [string])[0].trim());
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    // 2 stream_event lines + 1 final result line
    expect(parsed).toHaveLength(3);

    // First two are stream events with content_block_delta
    const streamEvents = parsed.filter((p) => p['type'] === 'stream_event');
    expect(streamEvents).toHaveLength(2);

    for (const evt of streamEvents) {
      expect(evt['session_id']).toBe('stream-session');
      expect(evt['uuid']).toBeDefined();
      const inner = evt['event'] as Record<string, unknown>;
      expect(inner['type']).toBe('content_block_delta');
      const delta = inner['delta'] as Record<string, unknown>;
      expect(delta['type']).toBe('text_delta');
    }

    const firstDelta = (streamEvents[0]!['event'] as Record<string, unknown>)['delta'] as Record<
      string,
      unknown
    >;
    const secondDelta = (streamEvents[1]!['event'] as Record<string, unknown>)['delta'] as Record<
      string,
      unknown
    >;
    expect(firstDelta['text']).toBe('Hello');
    expect(secondDelta['text']).toBe(' world');

    // Final result line
    const resultLine = parsed.find((p) => p['type'] === 'result');
    expect(resultLine).toEqual({
      type: 'result',
      result: 'Hello world',
      session_id: 'stream-session',
      subtype: 'success',
    });
  });

  it('stream-json emits error result on error', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(async () => {
        for (const h of listeners.get('error') ?? []) {
          h(new Error('stream error'));
        }
      }),
      getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
    } as unknown as InteractiveSession;

    const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
    const exitCode = await runner.run('test prompt');

    expect(exitCode).toBe(1);

    const lines = stdoutWriteSpy.mock.calls.map((call) => (call as [string])[0].trim());
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      type: 'result',
      result: '',
      session_id: 'stream-session',
      subtype: 'error',
    });
  });
});
