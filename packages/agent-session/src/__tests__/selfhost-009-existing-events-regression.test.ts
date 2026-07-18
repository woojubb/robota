/**
 * SELFHOST-009 TC-04 — regression: the existing catalogued events still fire at their documented
 * agent-session fire-sites, via the shared `runHooks` / `hookTypeExecutors` path.
 *
 * Covers the events fired directly by the turn owner: `UserPromptSubmit` and `Stop` (executeRun
 * happy path), `StopFailure` (executeRun error path), and `PreToolUse` + `PostToolUse` (the wrapped
 * tool). The remaining events (`SessionStart`/`SessionEnd`/`PreCompact`/`PostCompact`) and the
 * variable-dispatched Subagent/Worktree events are covered by their own package tests and by the
 * mechanical `scan-hook-catalog` firing-site floor.
 */

import { createUserMessage } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ContextWindowTracker } from '../context-window-tracker.js';
import { PermissionEnforcer } from '../permission-enforcer.js';
import { executeRun } from '../session-run.js';

import type { IRunContext } from '../session-run.js';
import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type {
  IAIProvider,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
  IToolResult,
  IToolWithEventService,
  ITerminalOutput,
  Robota,
  THooksConfig,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

function makeRecordingExecutor(exitCode = 0): {
  executor: IHookTypeExecutor;
  events: string[];
} {
  const events: string[] = [];
  const executor: IHookTypeExecutor = {
    type: 'command',
    execute: vi.fn(async (_def, input: IHookInput): Promise<IHookResult> => {
      events.push(input.hook_event_name);
      return { exitCode, stdout: '', stderr: '' };
    }),
  };
  return { executor, events };
}

function allEventsConfig(): THooksConfig {
  const group = { matcher: '', hooks: [{ type: 'command' as const, command: 'noop' }] };
  return {
    UserPromptSubmit: [group],
    Stop: [group],
    StopFailure: [group],
    PreToolUse: [group],
    PostToolUse: [group],
  };
}

function createFakeRobota(behavior: 'ok' | 'throw'): Robota {
  const messages: TUniversalMessage[] = [];
  const run = vi.fn(async (message: string): Promise<string> => {
    messages.push(createUserMessage(message));
    if (behavior === 'throw') throw new Error('provider exploded');
    return 'final response';
  });
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
  executor: IHookTypeExecutor,
): IRunContext {
  return {
    sessionId: 'test-session',
    cwd: '/tmp/test',
    model: 'test-model',
    robota,
    aiProvider: createProvider(),
    contextTracker: new ContextWindowTracker('test-model', undefined, false),
    hooks: hooks as unknown as Record<string, unknown>,
    hookTypeExecutors: [executor],
    sessionStartStdout: '',
    log: vi.fn(),
    compact: vi.fn(async () => {}),
    persistSession: vi.fn(),
    getSessionStore: () => false,
    clearSessionStartStdout: vi.fn(),
  };
}

function makeNoopTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function makeTool(name: string): IToolWithEventService {
  return {
    getName: () => name,
    execute: vi.fn(async (): Promise<IToolResult> => ({ success: true, data: 'ok', metadata: {} })),
    setEventService: vi.fn(),
  } as unknown as IToolWithEventService;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SELFHOST-009 TC-04 — existing events still fire (agent-session sites)', () => {
  it('fires UserPromptSubmit and Stop on the executeRun happy path', async () => {
    const { executor, events } = makeRecordingExecutor();
    const ctx = createContext(createFakeRobota('ok'), allEventsConfig(), executor);

    await executeRun('hello', undefined, ctx, new AbortController().signal);
    await flush();

    expect(events).toContain('UserPromptSubmit');
    expect(events).toContain('Stop');
  });

  it('fires StopFailure when the run throws', async () => {
    const { executor, events } = makeRecordingExecutor();
    const ctx = createContext(createFakeRobota('throw'), allEventsConfig(), executor);

    await expect(executeRun('hello', undefined, ctx, new AbortController().signal)).rejects.toThrow(
      'provider exploded',
    );
    await flush();

    expect(events).toContain('StopFailure');
  });

  it('fires PreToolUse and PostToolUse from the wrapped tool', async () => {
    const { executor, events } = makeRecordingExecutor();
    const options: IPermissionEnforcerOptions = {
      sessionId: 'test-session',
      cwd: '/tmp',
      getPermissionMode: () => 'bypassPermissions',
      config: { permissions: { allow: [], deny: [] }, hooks: allEventsConfig() },
      terminal: makeNoopTerminal(),
      hookTypeExecutors: [executor],
    };
    const enforcer = new PermissionEnforcer(options);
    const [wrapped] = enforcer.wrapTools([makeTool('Read')]);

    await wrapped!.execute({ path: '/x' });
    await flush();

    expect(events).toContain('PreToolUse');
    expect(events).toContain('PostToolUse');
  });
});
