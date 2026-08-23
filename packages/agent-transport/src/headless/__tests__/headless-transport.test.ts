import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest';
import { createHeadlessTransport } from '../headless-transport.js';
import type { IHeadlessSession } from '../headless-session.js';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { IExecutionResult, IInteractiveSession } from '@robota-sdk/agent-interface-session';

function createEventDrivenMockSession(
  behavior: 'complete' | 'error' | 'interrupted' = 'complete',
  options?: { response?: string; textDeltas?: string[] },
): IInteractiveSession {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const response = options?.response ?? 'test output';
  const textDeltas = options?.textDeltas;

  return Object.assign(createTestInteractiveSession(), {
    submit: vi.fn(async () => {
      if (textDeltas) {
        for (const delta of textDeltas) {
          for (const h of listeners.get('text_delta') ?? []) {
            h(delta);
          }
        }
      }

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
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 0, usedTokens: 0, maxTokens: 200000 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({ message: 'ok', success: true }),
    listCommands: vi.fn().mockReturnValue([]),
    getSession: vi.fn().mockReturnValue({ getSessionId: () => 'test-id' }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    }),
  });
}

describe('createHeadlessTransport declaration compatibility (ARCH-012)', () => {
  it('preserves the legacy adapter declaration and accepts the named subset', () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'test' });
    expectTypeOf(transport).toMatchTypeOf<ITransportAdapter<IInteractiveSession>>();
    expectTypeOf(transport.attach).parameter(0).toMatchTypeOf<IHeadlessSession>();
  });
});

describe('createHeadlessTransport', () => {
  it('returns an adapter with name "headless"', () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    expect(transport.name).toBe('headless');
    expect(transport.lifecycle).toEqual({ kind: 'runner' });
    expect(Object.isFrozen(transport.lifecycle)).toBe(true);
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    await expect(transport.start()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'not-attached',
      transportName: 'headless',
    });
  });

  it('returns exit code 0 by default', () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    expect(transport.getExitCode()).toBe(0);
  });

  it('full lifecycle: attach → start → text output → exit code', async () => {
    const mockSession = createEventDrivenMockSession();

    // Capture stdout
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as never;

    try {
      const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
      transport.attach(mockSession as never);
      await transport.start();
      await transport.waitForCompletion();

      expect(transport.getExitCode()).toBe(0);
      expect(writes.join('')).toContain('test output');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const pendingSubmissions: Array<() => void> = [];
    try {
      await runTransportLifecycleConformance({
        subjectId: '@robota-sdk/agent-transport#createHeadlessTransport',
        kind: 'runner',
        createAdapter: () =>
          createHeadlessTransport({ outputFormat: 'text', prompt: 'ARCH-011 conformance' }),
        createSession: () =>
          Object.assign(createEventDrivenMockSession(), {
            submit: vi.fn(
              () =>
                new Promise<void>((resolve) => {
                  pendingSubmissions.push(resolve);
                }),
            ),
          }),
        assertReady: () => {},
        assertStopped: () => {},
        completeRunner: () => {
          const complete = pendingSubmissions.shift();
          if (!complete) throw new Error('no pending headless submission');
          complete();
        },
      });
    } finally {
      write.mockRestore();
    }
  });
});

describe('createHeadlessTransport (json adapter)', () => {
  let stdoutWriteSpy: any; // allow-any: vi.spyOn process.stdout.write has incompatible MockInstance generic bounds

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('full lifecycle: attach → start → JSON output → exit code', async () => {
    const mockSession = createEventDrivenMockSession('complete', {
      response: 'JSON adapter result',
    });

    const transport = createHeadlessTransport({ outputFormat: 'json', prompt: 'test prompt' });
    transport.attach(mockSession as never);
    await transport.start();
    await expect(transport.waitForCompletion()).resolves.toEqual({
      status: 'succeeded',
      exitCode: 0,
    });

    expect(transport.getExitCode()).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);

    const output = (stdoutWriteSpy.mock.calls[0] as [string])[0];
    const parsed: unknown = JSON.parse(output.trim());
    expect(parsed).toEqual({
      type: 'result',
      result: 'JSON adapter result',
      session_id: 'test-id',
      subtype: 'success',
    });
  });
});

describe('createHeadlessTransport (stream-json adapter)', () => {
  let stdoutWriteSpy: any; // allow-any: vi.spyOn process.stdout.write has incompatible MockInstance generic bounds

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('full lifecycle: attach → start → stream events + result', async () => {
    const mockSession = createEventDrivenMockSession('complete', {
      response: 'Hello world',
      textDeltas: ['Hello', ' world'],
    });

    const transport = createHeadlessTransport({
      outputFormat: 'stream-json',
      prompt: 'test prompt',
    });
    transport.attach(mockSession as never);
    await transport.start();
    await expect(transport.waitForCompletion()).resolves.toEqual({
      status: 'succeeded',
      exitCode: 0,
    });

    expect(transport.getExitCode()).toBe(0);

    const lines = stdoutWriteSpy.mock.calls.map((call: unknown[]) => (call as [string])[0].trim());
    const parsed = lines.map((line: string) => JSON.parse(line) as Record<string, unknown>);

    // 2 stream_event lines + 1 final result line
    expect(parsed).toHaveLength(3);

    const streamEvents = parsed.filter(
      (p: Record<string, unknown>) => p['type'] === 'stream_event',
    );
    expect(streamEvents).toHaveLength(2);

    for (const evt of streamEvents) {
      expect(evt['session_id']).toBe('test-id');
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

    const resultLine = parsed.find((p: Record<string, unknown>) => p['type'] === 'result');
    expect(resultLine).toEqual({
      type: 'result',
      result: 'Hello world',
      session_id: 'test-id',
      subtype: 'success',
    });
  });
});

describe('createHeadlessTransport (error and interrupted)', () => {
  let stdoutWriteSpy: any; // allow-any: vi.spyOn process.stdout.write has incompatible MockInstance generic bounds

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('returns exit code 1 on error', async () => {
    const mockSession = createEventDrivenMockSession('error');

    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'test prompt' });
    transport.attach(mockSession as never);
    await transport.start();
    await expect(transport.waitForCompletion()).resolves.toEqual({
      status: 'failed',
      exitCode: 1,
    });

    expect(transport.getExitCode()).toBe(1);
  });

  it('returns exit code 0 on interrupted', async () => {
    const mockSession = createEventDrivenMockSession('interrupted', {
      response: 'partial output',
    });

    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'test prompt' });
    transport.attach(mockSession as never);
    await transport.start();
    await expect(transport.waitForCompletion()).resolves.toEqual({
      status: 'succeeded',
      exitCode: 0,
    });

    expect(transport.getExitCode()).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('partial output\n');
  });
});
