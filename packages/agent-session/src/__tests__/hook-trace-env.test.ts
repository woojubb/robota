/**
 * Hooks fired on a prompt's own path receive the prompt root's `TRACEPARENT` as a separate
 * argument to the command executor — never inside the hook input — and hooks outside a prompt
 * receive nothing.
 */
import { createUserMessage } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { CompactionOrchestrator } from '../compaction-orchestrator.js';
import { ContextWindowTracker } from '../context-window-tracker.js';
import { PermissionEnforcer } from '../permission-enforcer.js';
import { executeRun } from '../session-run.js';

import type { IRunContext } from '../session-run.js';
import type {
  IAIProvider,
  IHookInput,
  IHookTypeExecutor,
  IRunTraceContext,
  IToolExecutionContext,
  Robota,
  THookEvent,
  THooksConfig,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const ROOT_SPAN = 'b7ad6b7169203331';
const ROOT = { TRACEPARENT: `00-${TRACE_ID}-${ROOT_SPAN}-01` };
const BODY = { TRACEPARENT: `00-${TRACE_ID}-00f067aa0ba902b7-01` };

interface ICall {
  readonly event: string;
  readonly input: IHookInput;
  readonly trace: unknown;
  readonly arity: number;
}

function recorder(): { executor: IHookTypeExecutor; calls: ICall[] } {
  const calls: ICall[] = [];
  const executor = {
    type: 'command',
    execute: vi.fn(async (...args: unknown[]) => {
      const input = args[1] as IHookInput;
      calls.push({ event: String(input.hook_event_name), input, trace: args[2], arity: args.length });
      return { outcome: 'allow' as const, source: 'command' as const, stdout: '' };
    }),
  } as IHookTypeExecutor;
  return { executor, calls };
}

function hooksFor(events: THookEvent[]): THooksConfig {
  return Object.fromEntries(
    events.map((event) => [event, [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }]]),
  ) as THooksConfig;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeRobota(fail = false): Robota {
  const messages: TUniversalMessage[] = [];
  return {
    getHistory: () => [...messages],
    run: vi.fn(async (message: string, options?: { onExecutionEvent?: (e: string, d: Record<string, unknown>) => void }) => {
      messages.push(createUserMessage(message));
      options?.onExecutionEvent?.('provider_request', { round: 1, provider: 'p', model: 'm' });
      options?.onExecutionEvent?.('provider_response_normalized', { round: 1 });
      if (fail) throw new Error('provider failed');
      return 'final';
    }),
  } as unknown as Robota;
}

function runContext(agent: Robota, executor: IHookTypeExecutor, compact = vi.fn(async () => {})): IRunContext {
  return {
    sessionId: 's', cwd: '/tmp', model: 'm', effort: 'high', agent,
    aiProvider: { name: 'p', chat: vi.fn(), supportsTools: () => true } as unknown as IAIProvider,
    contextTracker: new ContextWindowTracker('m', undefined, false),
    hooks: hooksFor(['UserPromptSubmit', 'PreModelCall', 'PostModelCall', 'Stop', 'StopFailure']) as never,
    hookTypeExecutors: [executor], sessionStartStdout: '', log: vi.fn(), compact,
    persistSession: vi.fn(), getSessionStore: () => false, clearSessionStartStdout: vi.fn(),
  };
}

const traced = (classes: IRunTraceContext['subprocessClasses']): IRunTraceContext => ({
  traceId: TRACE_ID, parentSpanId: ROOT_SPAN, allowedOrigins: [], subprocessClasses: classes,
});

describe('prompt hooks', () => {
  it('hand every prompt hook the root span when hooks are enabled', async () => {
    const { executor, calls } = recorder();
    await executeRun('hi', undefined, runContext(fakeRobota(), executor), new AbortController().signal, {
      traceContext: traced(['hooks']),
    });
    await flush();
    expect(calls.map((call) => call.event).sort()).toEqual(['PostModelCall', 'PreModelCall', 'Stop', 'UserPromptSubmit']);
    for (const call of calls) {
      expect(call.trace).toEqual(ROOT);
      expect(JSON.stringify(call.input)).not.toContain(ROOT.TRACEPARENT);
    }
  });

  it('hands StopFailure the root span too', async () => {
    const { executor, calls } = recorder();
    await expect(executeRun('hi', undefined, runContext(fakeRobota(true), executor), new AbortController().signal, {
      traceContext: traced(['hooks']),
    })).rejects.toThrow('provider failed');
    await flush();
    expect(calls.find((call) => call.event === 'StopFailure')?.trace).toEqual(ROOT);
  });

  it('hands nothing when hooks are not enabled or the turn is untraced', async () => {
    for (const traceContext of [traced(['shell']), undefined]) {
      const { executor, calls } = recorder();
      await executeRun('hi', undefined, runContext(fakeRobota(), executor), new AbortController().signal,
        traceContext ? { traceContext } : undefined);
      await flush();
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call.trace).toBeUndefined();
    }
  });

  it('hands the in-prompt auto compaction the root span', async () => {
    const { executor } = recorder();
    const compact = vi.fn(async () => {});
    const ctx = runContext(fakeRobota(), executor, compact);
    ctx.contextTracker.shouldAutoCompact = () => true;
    await executeRun('hi', undefined, ctx, new AbortController().signal, { traceContext: traced(['hooks']) });
    expect(compact).toHaveBeenCalledWith(expect.any(AbortSignal), ROOT);
  });
});

describe('compaction hooks', () => {
  it('hands PreCompact the value it is given and PostCompact nothing', async () => {
    const { executor, calls } = recorder();
    const orchestrator = new CompactionOrchestrator({
      sessionId: 's', cwd: '/tmp', model: 'm',
      hooks: hooksFor(['PreCompact']) as never, hookTypeExecutors: [executor],
    });
    const provider = { chat: vi.fn(async () => ({ role: 'assistant', content: 'summary' })) } as unknown as IAIProvider;
    await orchestrator.compact(provider, [createUserMessage('x')], undefined, undefined, 'auto', ROOT);
    await orchestrator.compact(provider, [createUserMessage('x')], undefined, undefined, 'manual');
    expect(calls.map((call) => call.trace)).toEqual([ROOT, undefined]);
  });
});

describe('tool hooks', () => {
  function setup() {
    const { executor, calls } = recorder();
    const enforcer = new PermissionEnforcer({
      sessionId: 's', cwd: '/tmp', getPermissionMode: () => 'bypassPermissions',
      config: {
        permissions: { allow: ['Probe'], deny: [] },
        hooks: hooksFor(['PreToolUse', 'PostToolUse', 'PermissionDecision']) as never,
      },
      terminal: {
        write: vi.fn(), writeLine: vi.fn(), writeMarkdown: vi.fn(), writeError: vi.fn(),
        prompt: vi.fn().mockResolvedValue(''), select: vi.fn().mockResolvedValue(0),
        spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
      },
      hookTypeExecutors: [executor],
    });
    const seen: IToolExecutionContext[] = [];
    const tool = {
      getName: () => 'Probe',
      execute: async (_p: unknown, context: IToolExecutionContext) => {
        seen.push(context);
        return { success: true, data: 'ok' };
      },
      setEventService: vi.fn(),
    } as never;
    const [wrapped] = enforcer.wrapTools([tool]);
    return { wrapped: wrapped!, calls, seen };
  }

  it('hand Pre/PostToolUse and PermissionDecision the root span, and the body its own span', async () => {
    const { wrapped, calls, seen } = setup();
    await wrapped.execute({}, {
      toolName: 'Probe', parameters: {}, executionId: 'c1', shellTraceEnv: BODY, hookTraceEnv: ROOT,
    } as IToolExecutionContext);
    await flush();
    expect(calls.map((call) => call.event).sort()).toEqual(['PermissionDecision', 'PostToolUse', 'PreToolUse']);
    for (const call of calls) {
      expect(call.trace).toEqual(ROOT);
      expect(JSON.stringify(call.input)).not.toContain(TRACE_ID);
    }
    expect(seen[0]?.shellTraceEnv).toEqual(BODY);
  });

  it('hand nothing to a call without a hook value', async () => {
    const { wrapped, calls } = setup();
    await wrapped.execute({}, { toolName: 'Probe', parameters: {}, executionId: 'c1' } as IToolExecutionContext);
    await flush();
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.trace).toBeUndefined();
  });
});
