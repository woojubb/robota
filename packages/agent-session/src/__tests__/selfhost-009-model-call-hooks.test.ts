/**
 * SELFHOST-009 TC-03 — PreModelCall / PostModelCall fire from the turn owner's provider-call
 * execution events, exactly once per round, via the shared `runHooks` / `hookTypeExecutors` path.
 *
 * - `provider_request` → `PreModelCall`
 * - `provider_response_normalized` → `PostModelCall` (the SINGLE canonical source — NOT
 *   `provider_response_raw`, which would double-fire per round)
 *
 * Both are INFORMATIONAL-ONLY: `onExecutionEvent` is void/un-awaited, so a hook returning exit-code-2
 * cannot block or mutate the run.
 */

import { createUserMessage } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ContextWindowTracker } from '../context-window-tracker.js';
import { executeRun } from '../session-run.js';

import type { IRunContext } from '../session-run.js';
import type {
  IAIProvider,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
  Robota,
  THooksConfig,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

/** A command executor that records every hook input it receives; returns the configured exit code. */
function makeRecordingExecutor(exitCode = 0): {
  executor: IHookTypeExecutor;
  inputs: IHookInput[];
} {
  const inputs: IHookInput[] = [];
  const executor: IHookTypeExecutor = {
    type: 'command',
    execute: vi.fn(async (_def, input: IHookInput): Promise<IHookResult> => {
      inputs.push(input);
      return { exitCode, stdout: '', stderr: exitCode === 2 ? 'denied' : '' };
    }),
  };
  return { executor, inputs };
}

/**
 * Fake Robota whose `run()` drives, per round, the real provider-call event sequence emitted by
 * `execution-round-streaming.ts`: `provider_request`, then `provider_response_raw`, then
 * `provider_response_normalized`.
 */
function createFakeRobota(rounds: number): Robota {
  const messages: TUniversalMessage[] = [];
  const run = vi.fn(
    async (
      message: string,
      options?: { onExecutionEvent?: (event: string, data: Record<string, unknown>) => void },
    ): Promise<string> => {
      messages.push(createUserMessage(message));
      for (let r = 0; r < rounds; r++) {
        options?.onExecutionEvent?.('provider_request', {
          round: r,
          provider: 'fake-provider',
          model: 'fake-model',
        });
        options?.onExecutionEvent?.('provider_response_raw', { round: r });
        options?.onExecutionEvent?.('provider_response_normalized', { round: r });
      }
      return 'final response';
    },
  );
  return {
    getHistory: (): TUniversalMessage[] => [...messages],
    run,
  } as unknown as Robota;
}

function createProvider(): IAIProvider {
  return {
    name: 'fake-provider',
    version: '1.0.0',
    chat: vi.fn(),
    generateResponse: vi.fn(),
    supportsTools: () => true,
    validateConfig: () => true,
  } as unknown as IAIProvider;
}

function createContext(
  robota: Robota,
  hooks: THooksConfig,
  hookTypeExecutors: IHookTypeExecutor[],
): IRunContext {
  return {
    sessionId: 'test-session',
    cwd: '/tmp/test',
    model: 'test-model',
    robota,
    aiProvider: createProvider(),
    contextTracker: new ContextWindowTracker('test-model', undefined, false),
    hooks: hooks as unknown as Record<string, unknown>,
    hookTypeExecutors,
    sessionStartStdout: '',
    log: vi.fn(),
    compact: vi.fn(async () => {}),
    persistSession: vi.fn(),
    getSessionStore: () => false,
    clearSessionStartStdout: vi.fn(),
  };
}

/** Flush the fire-and-forget microtasks queued by the void `runHooks(...)` calls. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SELFHOST-009 TC-03 — model-call hook events', () => {
  it('fires PreModelCall once per round on provider_request', async () => {
    const { executor, inputs } = makeRecordingExecutor();
    const hooks: THooksConfig = {
      PreModelCall: [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }],
    };
    const ctx = createContext(createFakeRobota(2), hooks, [executor]);

    await executeRun('hello', undefined, ctx, new AbortController().signal);
    await flushMicrotasks();

    const pre = inputs.filter((i) => i.hook_event_name === 'PreModelCall');
    expect(pre).toHaveLength(2);
    expect(pre[0]!.model).toBe('fake-model');
    expect(pre[0]!.provider).toBe('fake-provider');
  });

  it('fires PostModelCall on provider_response_normalized ONLY — no double-fire on raw', async () => {
    const { executor, inputs } = makeRecordingExecutor();
    const hooks: THooksConfig = {
      PostModelCall: [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }],
    };
    const ctx = createContext(createFakeRobota(3), hooks, [executor]);

    await executeRun('hello', undefined, ctx, new AbortController().signal);
    await flushMicrotasks();

    const post = inputs.filter((i) => i.hook_event_name === 'PostModelCall');
    // 3 rounds → exactly 3, proving it did NOT also fire on the 3 provider_response_raw events.
    expect(post).toHaveLength(3);
  });

  it('is informational-only: an exit-code-2 hook does not block or mutate the run', async () => {
    const { executor } = makeRecordingExecutor(2);
    const hooks: THooksConfig = {
      PreModelCall: [{ matcher: '', hooks: [{ type: 'command', command: 'deny' }] }],
      PostModelCall: [{ matcher: '', hooks: [{ type: 'command', command: 'deny' }] }],
    };
    const ctx = createContext(createFakeRobota(1), hooks, [executor]);

    const response = await executeRun('hello', undefined, ctx, new AbortController().signal);
    await flushMicrotasks();

    // The run completed normally; the "deny" hook result was never consulted for gating.
    expect(response).toBe('final response');
  });
});
