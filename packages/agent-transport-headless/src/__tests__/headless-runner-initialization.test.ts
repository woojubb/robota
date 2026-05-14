import { describe, it, expect, vi } from 'vitest';
import type { IInteractiveSession } from '@robota-sdk/agent-sdk';
import { createHeadlessRunner } from '../headless-runner.js';

describe('createHeadlessRunner initialization', () => {
  it('stream-json reads the session id after submit initializes the session', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    let initialized = false;
    const session = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
      }),
      off: vi.fn(),
      submit: vi.fn(async () => {
        initialized = true;
        for (const h of listeners.get('text_delta') ?? []) {
          h('Hello');
        }
        for (const h of listeners.get('complete') ?? []) {
          h({ response: 'Hello', history: [], toolSummaries: [], contextState: {} });
        }
      }),
      getSession: vi.fn(() => {
        if (!initialized) {
          throw new Error('InteractiveSession not initialized');
        }
        return { getSessionId: () => 'initialized-session' };
      }),
    } as unknown as IInteractiveSession;

    try {
      const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
      const exitCode = await runner.run('test prompt');

      expect(exitCode).toBe(0);
      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining('"session_id":"initialized-session"'),
      );
    } finally {
      stdoutWriteSpy.mockRestore();
    }
  });
});
