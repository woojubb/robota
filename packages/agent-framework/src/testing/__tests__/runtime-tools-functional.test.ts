import { rmSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';
import type {
  IToolAppView,
  IToolExecutionContext,
  IToolWithEventService,
} from '@robota-sdk/agent-core';

// A private home made by mkdtemp before any module that reads `homedir()` loads.
const isolatedHome = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'robota-tools-home-'));
});
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => isolatedHome,
}));
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

function viewTool(view: IToolAppView): IToolWithEventService {
  const schema = {
    name: 'ViewTool',
    description: 'Returns a result with a source view',
    parameters: { type: 'object' as const, properties: {} },
  };
  return {
    schema,
    getName: () => schema.name,
    getDescription: () => schema.description,
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [] }),
    setEventService: () => {},
    execute: async () => ({ success: true, data: 'listed', view }),
  };
}

describe('a source view and the driver of a direct call through real InteractiveSession', () => {
  const view: IToolAppView = {
    sourceId: 'files',
    resourceUri: 'ui://files/list',
    mimeType: 'text/html;profile=mcp-app',
    html: '<main id="private-view-html">rows</main>',
    callableTools: { list_files: 'ViewTool' },
  };

  it("names the view of the model's call only, reads it on demand, and keeps it out of context and history", async () => {
    harness = scriptedSession({
      turns: [{ toolCalls: [{ name: 'ViewTool', args: {} }] }, { text: 'done' }],
      additionalTools: [viewTool(view)],
    });
    await harness.submit('list files');
    const modelCall = harness.emittedEvents('tool_end').map(([state]) => state);
    expect(modelCall).toHaveLength(1);
    expect(modelCall[0]).toMatchObject({
      toolName: 'ViewTool',
      appView: { sourceId: 'files', resourceUri: 'ui://files/list' },
    });
    expect(JSON.stringify(modelCall[0])).not.toContain('private-view-html');
    const executionId = modelCall[0]!.executionId!;
    expect(harness.session.readToolAppView(executionId)).toEqual(view);

    const direct = await harness.session.invokeRuntimeTool('ViewTool', {});
    expect(direct).toMatchObject({ success: true });
    const ended = harness.emittedEvents('tool_end').map(([state]) => state);
    expect(ended).toHaveLength(2);
    expect(ended[1]).toMatchObject({ toolName: 'ViewTool', result: 'success' });
    expect(ended[1]).not.toHaveProperty('appView');
    expect(harness.session.readToolAppView(ended[1]!.executionId!)).toBeUndefined();

    expect(JSON.stringify(harness.requests)).not.toContain('private-view-html');
    expect(JSON.stringify(harness.history())).not.toContain('private-view-html');
    const recorded = JSON.stringify(harness.session.getFullHistory());
    expect(recorded).not.toContain('private-view-html');
    expect(recorded).not.toContain('ui://files/list');

    harness.session.clearConversationHistory();
    expect(harness.session.readToolAppView(executionId)).toBeUndefined();
  }, 20_000);

  it('forgets the views of a session that shut down', async () => {
    harness = scriptedSession({
      turns: [{ toolCalls: [{ name: 'ViewTool', args: {} }] }, { text: 'done' }],
      additionalTools: [viewTool(view)],
    });
    await harness.submit('list files');
    const executionId = harness.emittedEvents('tool_end')[0]![0].executionId!;
    expect(harness.session.readToolAppView(executionId)).toEqual(view);
    await harness.session.shutdown();
    expect(harness.session.readToolAppView(executionId)).toBeUndefined();
  }, 20_000);

  it('puts an interactive direct call to the person and names the driver it acts for', async () => {
    harness = scriptedSession({ turns: [{ text: 'unused' }], permissionMode: 'default' });
    const session = harness.session;
    const requests: Array<{ requesterDriverId?: string; activeDriver: string | null }> = [];
    session.on('permission_request', (request) => {
      requests.push({
        ...(request.requesterDriverId ? { requesterDriverId: request.requesterDriverId } : {}),
        activeDriver: session.getActiveDriverId(),
      });
      session.resolvePermission(request.id, false);
    });

    const refused = await session.invokeRuntimeTool(
      'Bash',
      { command: 'printf shown > shown.txt' },
      { permissionInteraction: 'interactive', driverId: 'drv-1' },
    );

    expect(refused.success).toBe(false);
    expect(requests).toEqual([{ requesterDriverId: 'drv-1', activeDriver: 'drv-1' }]);
    expect(harness.exists('shown.txt')).toBe(false);
    expect(session.getActiveDriverId()).toBeNull();
  }, 20_000);
});
