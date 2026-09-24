import { mkdirSync, rmSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';
import type { IToolExecutionContext, IToolWithEventService } from '@robota-sdk/agent-core';

const isolatedHome = vi.hoisted(() => `/tmp/robota-runtime-tools-home-${process.pid}`);
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => isolatedHome,
}));
beforeAll(() => {
  mkdirSync(isolatedHome, { recursive: true });
});
afterAll(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
});
let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function blockingTool(
  started: ReturnType<typeof deferred<AbortSignal>>,
  finish: Promise<void>,
): IToolWithEventService {
  const schema = {
    name: 'BlockingTool',
    description: 'Controlled cancellation test tool',
    parameters: { type: 'object' as const, properties: {} },
  };
  return {
    schema,
    getName: () => schema.name,
    getDescription: () => schema.description,
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [] }),
    setEventService: () => {},
    execute: async (_parameters, context?: IToolExecutionContext) => {
      if (!context?.signal) throw new Error('Missing invocation signal');
      started.resolve(context.signal);
      await finish;
      return {
        success: !context.signal.aborted,
        data: 'finished',
        error: context.signal.aborted ? 'cancelled' : undefined,
      };
    },
  };
}

describe('canonical runtime tools through real InteractiveSession', () => {
  it('lists canonical commands and runs an ordinary tool with audit events and no model turn', async () => {
    harness = scriptedSession({
      turns: [{ text: 'unused' }],
      commandModules: [
        {
          name: 'runtime-test',
          systemCommands: [
            {
              name: 'echo',
              description: 'Echo command',
              modelInvocable: true,
              lifecycle: 'blocking',
              execute: async () => ({ success: true, message: 'echoed' }),
            },
          ],
        },
      ],
    });
    const catalog = await harness.session.listRuntimeTools();
    expect(catalog.some((tool) => tool.name === 'Bash')).toBe(true);
    expect(catalog.some((tool) => tool.name === 'command_echo')).toBe(true);
    const result = await harness.session.invokeRuntimeTool('Bash', {
      command: 'printf canonical > direct.txt',
    });
    expect(result.success).toBe(true);
    expect(harness.readFile('direct.txt')).toBe('canonical');
    expect(harness.requests).toHaveLength(0);
    expect(harness.logEntries().some((entry) => entry.event === 'tool_call')).toBe(true);
    expect(harness.emittedEvents('tool_start')).toHaveLength(1);
    expect(harness.emittedEvents('tool_end')).toHaveLength(1);
  }, 20_000);

  it('denies a call requiring interaction even with a subscribed permission surface', async () => {
    harness = scriptedSession({ turns: [{ text: 'unused' }], permissionMode: 'default' });
    const permission = vi.fn();
    harness.session.on('permission_request', permission);
    const result = await harness.session.invokeRuntimeTool('Bash', {
      command: 'printf denied > denied.txt',
    });
    expect(result.success).toBe(false);
    expect(permission).not.toHaveBeenCalled();
    expect(harness.exists('denied.txt')).toBe(false);
    expect(harness.requests).toHaveLength(0);
  }, 20_000);

  it('retains ownership after cancellation until the tool settles and shutdown drains it', async () => {
    const started = deferred<AbortSignal>();
    const finish = deferred<void>();
    harness = scriptedSession({
      turns: [{ text: 'unused' }],
      additionalTools: [blockingTool(started, finish.promise)],
    });
    const abort = new AbortController();
    const invocation = harness.session.invokeRuntimeTool(
      'BlockingTool',
      {},
      { signal: abort.signal },
    );
    const signal = await started.promise;
    abort.abort();
    expect(signal.aborted).toBe(true);
    await expect(harness.session.submit('blocked')).rejects.toThrow(/runtime tool/i);
    await expect(harness.session.invokeRuntimeTool('Bash', { command: 'true' })).rejects.toThrow(
      /already running/i,
    );
    let shutDown = false;
    const shutdown = harness.session.shutdown().then(() => {
      shutDown = true;
    });
    await Promise.resolve();
    expect(shutDown).toBe(false);
    finish.resolve();
    await expect(invocation).resolves.toMatchObject({ success: false });
    await shutdown;
    await expect(harness.session.listRuntimeTools()).rejects.toThrow(/shutting down/i);
  }, 20_000);

  it('cancels a submitted turn without cancelling another driver waiting behind it', async () => {
    const started = deferred<AbortSignal>();
    const finish = deferred<void>();
    harness = scriptedSession({
      turns: [{ toolCalls: [{ name: 'BlockingTool', args: {} }] }, { text: 'SURVIVED' }],
      additionalTools: [blockingTool(started, finish.promise)],
    });
    const abort = new AbortController();
    const active = harness.session.submit('active', undefined, undefined, {
      driverId: 'active',
      signal: abort.signal,
    });
    const signal = await started.promise;
    const waiting = await harness.session.submit('waiting', undefined, undefined, {
      driverId: 'waiting',
    });
    try {
      abort.abort();
      expect(signal.aborted).toBe(true);
      expect(harness.session.getPendingCount()).toBe(1);
    } finally {
      finish.resolve();
    }
    const own = await active;
    await own.completed;
    await expect(waiting.completed).resolves.toMatchObject({ response: 'SURVIVED' });
    expect(harness.emittedEvents('interrupted')).toHaveLength(1);
    expect(harness.session.getPendingCount()).toBe(0);
    // An abort after this owned turn has settled cannot interrupt a later caller.
    abort.abort();
  }, 20_000);
});
