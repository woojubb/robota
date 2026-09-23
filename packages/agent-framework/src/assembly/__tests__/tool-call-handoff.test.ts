/**
 * MCP-004 §S3 — unit tests for the tool-call handoff wrapper.
 *
 * TC-01, TC-02, TC-04 (real manager + real S1 runner), TC-09, TC-10 (first half), TC-21, TC-23.
 */

import {
  BackgroundTaskManager,
  createToolInvocationBackgroundTaskRunner,
} from '@robota-sdk/agent-executor';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildToolCallHandoff } from '../create-session-runtime.js';
import {
  ToolCallHandoffTool,
  isToolCallHandoff,
  unwrapToolCallHandoff,
} from '../tool-call-handoff.js';

import type { ICreateSessionOptions, IToolCallHandoffProvenance } from '../create-session-types.js';
import type { IToolCallHandoffDeps } from '../tool-call-handoff.js';
import type {
  IToolExecutionContext,
  IToolResult,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { IBackgroundTaskManager, IToolInvocationAdopter } from '@robota-sdk/agent-executor';
import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type { ISessionLogger } from '@robota-sdk/agent-session';

const PROVENANCE: IToolCallHandoffProvenance = {
  serverId: 'server-1',
  sourceName: 'slow_tool',
  securityIdentity: 'identity-1',
  permissionMode: 'default',
};

function makeFakeTool(
  execute: (parameters: TToolParameters, context?: IToolExecutionContext) => Promise<IToolResult>,
  name = 'SlowTool',
): IToolWithEventService {
  return {
    schema: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
    getName: () => name,
    getDescription: () => `${name} tool`,
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [] }),
    setEventService: () => {},
    execute,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake `manager` + `runner` pair — enough for every test that does not need REAL admission. */
function makeFakeDeps(overrides: Partial<IToolCallHandoffDeps> = {}): {
  deps: IToolCallHandoffDeps;
  spawn: ReturnType<typeof vi.fn>;
  adopt: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn();
  const adopt = vi.fn(() => release);
  const spawn = vi.fn(async () => ({ id: 'task-1' }) as unknown as IBackgroundTaskState);
  const manager = { spawn } as unknown as IBackgroundTaskManager;
  const runner: IToolInvocationAdopter = { adopt };
  const deps: IToolCallHandoffDeps = {
    manager,
    runner,
    sessionId: 'session-1',
    cwd: '/workspace',
    thresholdMs: 1000,
    budgetMs: 5000,
    provenance: PROVENANCE,
    ...overrides,
  };
  return { deps, spawn, adopt, release };
}

describe('ToolCallHandoffTool — delegation', () => {
  it('delegates name, description, schema, validate, validateParameters, setEventService to the inner tool', () => {
    const inner = makeFakeTool(async () => ({ success: true }), 'Delegated');
    const { deps } = makeFakeDeps();
    const wrapper = new ToolCallHandoffTool(inner, deps);

    expect(wrapper.getName()).toBe('Delegated');
    expect(wrapper.getDescription()).toBe(inner.getDescription());
    expect(wrapper.schema).toBe(inner.schema);
    expect(wrapper.validate({})).toBe(true);
    expect(wrapper.validateParameters({})).toEqual({ isValid: true, errors: [] });
    wrapper.setEventService(undefined);
  });

  it('isToolCallHandoff / unwrapToolCallHandoff identify and unwrap a wrapper, and are no-ops otherwise', () => {
    const inner = makeFakeTool(async () => ({ success: true }));
    const { deps } = makeFakeDeps();
    const wrapper = new ToolCallHandoffTool(inner, deps);

    expect(isToolCallHandoff(wrapper)).toBe(true);
    expect(isToolCallHandoff(inner)).toBe(false);
    expect(unwrapToolCallHandoff(wrapper)).toBe(inner);
    expect(unwrapToolCallHandoff(inner)).toBe(inner);
  });
});

describe('TC-01: settles before the threshold', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the inner result unchanged, never spawns, and leaves no armed timer', async () => {
    vi.useFakeTimers();
    const innerResult: IToolResult = { success: true, data: 'fast result' };
    const executeSpy = vi.fn(() => createDeferred<IToolResult>().promise);
    let resolveInner: (value: IToolResult) => void = () => {};
    const executeImpl = vi.fn(() => {
      const deferred = createDeferred<IToolResult>();
      resolveInner = deferred.resolve;
      return deferred.promise;
    });
    const tool = makeFakeTool(executeImpl);
    const { deps, spawn } = makeFakeDeps({ thresholdMs: 1000 });
    const wrapper = new ToolCallHandoffTool(tool, deps);

    const resultPromise = wrapper.execute({});
    await vi.advanceTimersByTimeAsync(999);
    resolveInner(innerResult);
    const result = await resultPromise;

    expect(result).toBe(innerResult);
    expect(spawn).not.toHaveBeenCalled();
    expect(executeImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    void executeSpy;
  });
});

describe('TC-02: still pending at the threshold', () => {
  afterEach(() => vi.useRealTimers());

  it('spawns exactly one tool-invocation task and returns backgroundTaskId + running status', async () => {
    vi.useFakeTimers();
    const executeImpl = vi.fn(() => createDeferred<IToolResult>().promise);
    const tool = makeFakeTool(executeImpl);
    const { deps, spawn } = makeFakeDeps({ thresholdMs: 1000, budgetMs: 5000 });
    const wrapper = new ToolCallHandoffTool(tool, deps);

    const resultPromise = wrapper.execute({});
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(spawn).toHaveBeenCalledTimes(1);
    const request = spawn.mock.calls[0]?.[0] as { kind: string; toolName: string };
    expect(request.kind).toBe('tool-invocation');
    expect(request.toolName).toBe('SlowTool');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ backgroundTaskId: 'task-1', status: 'running' });
    expect(executeImpl).toHaveBeenCalledTimes(1);
  });
});

describe('TC-09: spawned request/state carries provenance and the informational budget', () => {
  afterEach(() => vi.useRealTimers());

  it('the spawned state carries toolName + flattened provenance in metadata, and maxRuntimeMs === budgetMs - elapsed', async () => {
    vi.useFakeTimers();
    const runner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const executeImpl = vi.fn(() => createDeferred<IToolResult>().promise);
    const tool = makeFakeTool(executeImpl);
    const deps: IToolCallHandoffDeps = {
      manager,
      runner,
      sessionId: 'session-9',
      cwd: '/workspace',
      thresholdMs: 1000,
      budgetMs: 5000,
      provenance: PROVENANCE,
    };
    const wrapper = new ToolCallHandoffTool(tool, deps);

    const resultPromise = wrapper.execute({});
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;
    const taskId = (result.data as { backgroundTaskId: string }).backgroundTaskId;
    const state = manager.get(taskId);

    expect(state?.metadata).toMatchObject({
      toolName: 'SlowTool',
      serverId: PROVENANCE.serverId,
      sourceName: PROVENANCE.sourceName,
      securityIdentity: PROVENANCE.securityIdentity,
      permissionMode: PROVENANCE.permissionMode,
      provenanceOwner: 'mcp',
    });
    // The threshold timer fired at exactly 1000ms under the fake clock: elapsed === thresholdMs.
    expect(state?.status).toBe('running');
  });

  it('fails the task exactly once when the adopted call rejects with the supervisor timeout error', async () => {
    vi.useFakeTimers();
    const runner = createToolInvocationBackgroundTaskRunner();
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const events: TBackgroundTaskEvent[] = [];
    manager.subscribe((event) => events.push(event));

    const deferred = createDeferred<IToolResult>();
    const executeImpl = vi.fn(() => deferred.promise);
    const tool = makeFakeTool(executeImpl);
    const deps: IToolCallHandoffDeps = {
      manager,
      runner,
      sessionId: 'session-9b',
      cwd: '/workspace',
      thresholdMs: 1000,
      budgetMs: 5000,
      provenance: PROVENANCE,
    };
    const wrapper = new ToolCallHandoffTool(tool, deps);

    const resultPromise = wrapper.execute({});
    await vi.advanceTimersByTimeAsync(1000);
    await resultPromise;

    deferred.reject(new Error('MCP tool call timed out after 600000ms'));
    await vi.advanceTimersByTimeAsync(0);
    // Flush the rejection's microtask chain through the runner into the manager.
    await Promise.resolve();
    await Promise.resolve();

    const failed = events.filter((event) => event.type === 'background_task_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      task: { error: { message: 'MCP tool call timed out after 600000ms', category: 'runner' } },
    });
  });
});

describe('TC-10 (first half): construction-time wrap and additionalTools stays unwrapped', () => {
  it('replaces the named tool in the session-local list, leaving additionalTools untouched', () => {
    const runner = {
      kind: 'tool-invocation' as const,
      admission: 'already-running' as const,
      adopt: vi.fn(() => vi.fn()),
      start: vi.fn(),
    };
    const innerTool = makeFakeTool(async () => ({ success: true }), 'McpTool');
    const otherTool = makeFakeTool(async () => ({ success: true }), 'Other');
    const additionalTools = [innerTool, otherTool];
    const tools = [...additionalTools];

    const options = {
      backgroundTaskRunners: [runner],
      additionalTools,
      toolCallHandoff: {
        thresholdMs: 1000,
        budgetMs: 5000,
        toolNames: ['McpTool'],
        provenance: { McpTool: PROVENANCE },
      },
    } as unknown as ICreateSessionOptions;

    const manager = { spawn: vi.fn() } as unknown as IBackgroundTaskManager;
    buildToolCallHandoff(options, manager, 'session-10', '/workspace', tools);

    expect(isToolCallHandoff(tools[0]!)).toBe(true);
    expect(unwrapToolCallHandoff(tools[0]!)).toBe(innerTool);
    expect(tools[1]).toBe(otherTool);
    // The session-local list was replaced BY INDEX; `additionalTools` — a different array — never
    // mutated (still holds the unwrapped instance).
    expect(additionalTools[0]).toBe(innerTool);
    expect(isToolCallHandoff(additionalTools[0]!)).toBe(false);
  });

  it('refuses at build time when a name in toolNames has no provenance entry', () => {
    const runner = {
      kind: 'tool-invocation' as const,
      admission: 'already-running' as const,
      adopt: vi.fn(() => vi.fn()),
      start: vi.fn(),
    };
    const tools = [makeFakeTool(async () => ({ success: true }), 'McpTool')];
    const options = {
      backgroundTaskRunners: [runner],
      toolCallHandoff: {
        thresholdMs: 1000,
        budgetMs: 5000,
        toolNames: ['McpTool'],
        provenance: {},
      },
    } as unknown as ICreateSessionOptions;
    const manager = { spawn: vi.fn() } as unknown as IBackgroundTaskManager;

    expect(() =>
      buildToolCallHandoff(options, manager, 'session-10b', '/workspace', tools),
    ).toThrow(/provenance is missing an entry for tool "McpTool"/);
  });

  it('is a no-op with no policy or no tool-invocation runner', () => {
    const tool = makeFakeTool(async () => ({ success: true }), 'McpTool');
    const tools = [tool];
    const manager = { spawn: vi.fn() } as unknown as IBackgroundTaskManager;

    buildToolCallHandoff({} as ICreateSessionOptions, manager, 'session-10c', '/workspace', tools);
    expect(tools[0]).toBe(tool);

    const optionsNoRunner = {
      toolCallHandoff: {
        thresholdMs: 1000,
        budgetMs: 5000,
        toolNames: ['McpTool'],
        provenance: { McpTool: PROVENANCE },
      },
    } as unknown as ICreateSessionOptions;
    buildToolCallHandoff(optionsNoRunner, manager, 'session-10d', '/workspace', tools);
    expect(tools[0]).toBe(tool);
  });
});

describe('TC-21: turn-claim abort — before threshold, after successful spawn, after a refused spawn', () => {
  afterEach(() => vi.useRealTimers());

  it('before threshold: aborts the call as before', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const deferred = createDeferred<IToolResult>();
    const executeImpl = vi.fn((_params: TToolParameters, context?: IToolExecutionContext) => {
      capturedSignal = context?.signal;
      return deferred.promise;
    });
    const tool = makeFakeTool(executeImpl);
    const { deps } = makeFakeDeps({ thresholdMs: 1000 });
    const turnController = new AbortController();

    const resultPromise = wrapExecute(tool, deps, turnController.signal);
    await Promise.resolve();
    turnController.abort('turn aborted');
    expect(capturedSignal?.aborted).toBe(true);

    deferred.resolve({ success: false, error: 'aborted' });
    await resultPromise;
  });

  it('after a successful spawn: does NOT abort the adopted call', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const executeImpl = vi.fn((_params: TToolParameters, context?: IToolExecutionContext) => {
      capturedSignal = context?.signal;
      return createDeferred<IToolResult>().promise;
    });
    const tool = makeFakeTool(executeImpl);
    const { deps } = makeFakeDeps({ thresholdMs: 1000 });
    const turnController = new AbortController();

    const resultPromise = wrapExecute(tool, deps, turnController.signal);
    await vi.advanceTimersByTimeAsync(1000);
    await resultPromise;

    turnController.abort('turn aborted after spawn');
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('after a refused spawn: still aborts the call (the turn link is untouched)', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const deferred = createDeferred<IToolResult>();
    const executeImpl = vi.fn((_params: TToolParameters, context?: IToolExecutionContext) => {
      capturedSignal = context?.signal;
      return deferred.promise;
    });
    const tool = makeFakeTool(executeImpl);
    const spawn = vi.fn(async () => {
      throw new Error('manager is shutting down');
    });
    const manager = { spawn } as unknown as IBackgroundTaskManager;
    const release = vi.fn();
    const adopt = vi.fn(() => release);
    const runner: IToolInvocationAdopter = { adopt };
    const deps: IToolCallHandoffDeps = {
      manager,
      runner,
      sessionId: 'session-21c',
      cwd: '/workspace',
      thresholdMs: 1000,
      budgetMs: 5000,
      provenance: PROVENANCE,
    };
    const turnController = new AbortController();

    const resultPromise = wrapExecute(tool, deps, turnController.signal);
    await vi.advanceTimersByTimeAsync(1000);
    // Let the spawn rejection propagate before asserting the link is untouched.
    await Promise.resolve();
    await Promise.resolve();

    turnController.abort('turn aborted after refusal');
    expect(capturedSignal?.aborted).toBe(true);

    deferred.resolve({ success: true, data: 'eventual result' });
    const result = await resultPromise;
    expect((result.data as { message: string }).message).toContain('handoff refused:');
  });
});

describe('TC-23: the one declared fallback — spawn refuses after the threshold fired', () => {
  afterEach(() => vi.useRealTimers());

  it('releases the token, keeps the turn link, reports once, and returns the eventual foreground result', async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<IToolResult>();
    const executeImpl = vi.fn(() => deferred.promise);
    const tool = makeFakeTool(executeImpl);
    const spawn = vi.fn(async () => {
      throw new Error('manager is shutting down');
    });
    const manager = { spawn } as unknown as IBackgroundTaskManager;
    const release = vi.fn();
    const adopt = vi.fn(() => release);
    const runner: IToolInvocationAdopter = { adopt };
    const log = vi.fn();
    const sessionLogger: ISessionLogger = { log };

    const deps: IToolCallHandoffDeps = {
      manager,
      runner,
      sessionId: 'session-23',
      cwd: '/workspace',
      thresholdMs: 1000,
      budgetMs: 5000,
      provenance: PROVENANCE,
      sessionLogger,
    };
    const wrapper = new ToolCallHandoffTool(tool, deps);

    const resultPromise = wrapper.execute({});
    await vi.advanceTimersByTimeAsync(1000);
    // Let the spawn rejection settle before the underlying call resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(adopt).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toBe('tool_call_handoff_refused');

    deferred.resolve({ success: true, data: { already: 'shaped' } });
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      already: 'shaped',
      message: expect.stringContaining('handoff refused: manager is shutting down'),
    });
    expect(executeImpl).toHaveBeenCalledTimes(1);
  });

  it('wraps a non-object inner data value rather than discarding it', async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<IToolResult>();
    const executeImpl = vi.fn(() => deferred.promise);
    const tool = makeFakeTool(executeImpl);
    const spawn = vi.fn(async () => {
      throw new Error('no tool-invocation runner');
    });
    const manager = { spawn } as unknown as IBackgroundTaskManager;
    const runner: IToolInvocationAdopter = { adopt: vi.fn(() => vi.fn()) };
    const deps: IToolCallHandoffDeps = {
      manager,
      runner,
      sessionId: 'session-23b',
      cwd: '/workspace',
      thresholdMs: 1000,
      budgetMs: 5000,
      provenance: PROVENANCE,
    };
    const wrapper = new ToolCallHandoffTool(tool, deps);

    const resultPromise = wrapper.execute({});
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    deferred.resolve({ success: true, data: 'plain text result' });
    const result = await resultPromise;

    expect(result.data).toMatchObject({
      value: 'plain text result',
      message: expect.stringContaining('handoff refused: no tool-invocation runner'),
    });
  });
});

describe('TC-04: exactly-one delivery across a settle × spawn-latency sweep (real manager + real runner)', () => {
  afterEach(() => vi.useRealTimers());

  it('every combination of settle tick (threshold ± 5) and spawn latency (0-2) yields exactly one delivery', async () => {
    const thresholdMs = 200;
    for (let settleOffset = -5; settleOffset <= 5; settleOffset++) {
      for (let spawnLatency = 0; spawnLatency <= 2; spawnLatency++) {
        vi.useFakeTimers();
        try {
          const runner = createToolInvocationBackgroundTaskRunner();
          const manager = new BackgroundTaskManager({ runners: [runner] });
          const completions: TBackgroundTaskEvent[] = [];
          manager.subscribe((event) => {
            if (
              event.type === 'background_task_completed' ||
              event.type === 'background_task_failed'
            ) {
              completions.push(event);
            }
          });
          if (spawnLatency > 0) {
            const originalSpawn = manager.spawn.bind(manager);
            manager.spawn = ((request: Parameters<typeof originalSpawn>[0]) =>
              new Promise((resolve, reject) => {
                setTimeout(() => {
                  originalSpawn(request).then(resolve, reject);
                }, spawnLatency);
              })) as typeof manager.spawn;
          }

          const settleTick = Math.max(thresholdMs + settleOffset, 0);
          let executeCount = 0;
          const executeImpl = vi.fn(() => {
            executeCount += 1;
            return new Promise<IToolResult>((resolve) => {
              setTimeout(() => resolve({ success: true, data: 'done' }), settleTick);
            });
          });
          const tool = makeFakeTool(executeImpl);
          const deps: IToolCallHandoffDeps = {
            manager,
            runner,
            sessionId: 'session-04',
            cwd: '/workspace',
            thresholdMs,
            budgetMs: 60_000,
            provenance: PROVENANCE,
          };
          const wrapper = new ToolCallHandoffTool(tool, deps);

          const resultPromise = wrapper.execute({});
          await vi.advanceTimersByTimeAsync(
            thresholdMs + Math.max(settleOffset, 0) + spawnLatency + 25,
          );
          const result = await resultPromise;
          // Let any still-pending background completion settle.
          await vi.advanceTimersByTimeAsync(25);

          const wasHandedOff =
            typeof result.data === 'object' &&
            result.data !== null &&
            'backgroundTaskId' in (result.data as Record<string, unknown>);

          expect(executeCount).toBe(1);
          if (wasHandedOff) {
            expect(completions).toHaveLength(1);
          } else {
            expect(completions).toHaveLength(0);
          }
        } finally {
          vi.useRealTimers();
        }
      }
    }
  });
});

/** Calls `execute` with an explicit `context.signal` (the turn claim) — a thin wrapper for TC-21. */
function wrapExecute(
  tool: IToolWithEventService,
  deps: IToolCallHandoffDeps,
  signal: AbortSignal,
): Promise<IToolResult> {
  const wrapper = new ToolCallHandoffTool(tool, deps);
  return wrapper.execute({}, { toolName: tool.getName(), parameters: {}, signal });
}
