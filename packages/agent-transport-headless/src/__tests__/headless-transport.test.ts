import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHeadlessTransport } from '../headless-transport.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IExecutionResult } from '@robota-sdk/agent-sdk';

function createMockSession(): InteractiveSession {
  return {
    submit: vi.fn(),
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
    getSession: vi.fn().mockReturnValue({ getSessionId: () => 'test-session-id' }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as InteractiveSession;
}

function createEventDrivenMockSession(
  behavior: 'complete' | 'error' | 'interrupted' = 'complete',
  options?: { response?: string; textDeltas?: string[] },
): InteractiveSession {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const response = options?.response ?? 'test output';
  const textDeltas = options?.textDeltas;

  return {
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
  } as unknown as InteractiveSession;
}

describe('createHeadlessTransport', () => {
  it('returns an adapter with name "headless"', () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    expect(transport.name).toBe('headless');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    await expect(transport.start()).rejects.toThrow('No session attached');
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
      transport.attach(mockSession);
      await transport.start();

      expect(transport.getExitCode()).toBe(0);
      expect(writes.join('')).toContain('test output');
    } finally {
      process.stdout.write = originalWrite;
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
    transport.attach(mockSession);
    await transport.start();

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
    transport.attach(mockSession);
    await transport.start();

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
    transport.attach(mockSession);
    await transport.start();

    expect(transport.getExitCode()).toBe(1);
  });

  it('returns exit code 0 on interrupted', async () => {
    const mockSession = createEventDrivenMockSession('interrupted', {
      response: 'partial output',
    });

    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'test prompt' });
    transport.attach(mockSession);
    await transport.start();

    expect(transport.getExitCode()).toBe(0);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('partial output\n');
  });
});
