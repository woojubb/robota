import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import { expect, it, vi } from 'vitest';

import { createWorkflowsCommandModule } from '../workflows-command-module.js';
import { DetachedWorkflowRuns } from '../detached-runs.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import type { IAIProvider, IProviderDefinition, TUniversalMessage } from '@robota-sdk/agent-core';

it('returns a stable detached run ID that another operator command can inspect and actively cancel', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-detached-')));
  await writeFile(
    join(root, 'flow.json'),
    JSON.stringify({
      dagId: 'detached',
      version: 1,
      status: 'draft',
      nodes: [],
      edges: [],
    }),
  );
  let entered!: () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let sawAbort = false;
  const execute = vi
    .spyOn(LocalDagRuntimeProvider.prototype, 'execute')
    .mockImplementation(async (_dag, _inputs, options) => {
      entered();
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) resolve();
        else
          options?.signal?.addEventListener(
            'abort',
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true },
          );
      });
      return { ok: true, outputs: { text: 'late success' }, durationMs: 1 };
    });
  try {
    const module = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
    });
    const command = module.systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });
    const started = await command.execute(context, 'run flow.json --detach');
    expect(started.success).toBe(true);
    const runId = started.message.match(/Run ID: ([\w-]+)/)?.[1];
    expect(runId).toBeTruthy();
    await running;
    const active = await command.execute(context, `status ${runId}`);
    expect(active.message).toContain('running');
    const secondSession = createTestCommandHost({ cwd: root });
    expect((await command.execute(secondSession, `status ${runId}`)).message).toContain(
      'Unknown workflow run ID',
    );
    const otherHost = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
    }).systemCommands?.[0];
    expect((await otherHost?.execute(context, `status ${runId}`))?.message).toContain(
      'Unknown workflow run ID',
    );
    const cancelled = await command.execute(context, `cancel ${runId}`);
    expect(cancelled.success).toBe(true);
    expect(sawAbort).toBe(true);
    const terminal = await command.execute(context, `status ${runId}`);
    expect(terminal.message).toContain('cancelled');
    expect(terminal.message).not.toContain('late success');
    await module.shutdown?.(context);
    const laterSessionRun = await command.execute(secondSession, 'run flow.json --detach');
    expect(laterSessionRun.success).toBe(true);
    await module.shutdown?.(secondSession);
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    execute.mockRestore();
  }
});

it('keeps cancellation as the terminal status when detached runtime cleanup rejects', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-detached-rejection-')));
  vi.stubEnv('HOME', root);
  await writeFile(
    join(root, 'flow.json'),
    JSON.stringify({ dagId: 'detached-rejection', version: 1, status: 'draft', nodes: [], edges: [] }),
  );
  let entered!: (signal: AbortSignal | undefined) => void;
  const running = new Promise<AbortSignal | undefined>((resolve) => { entered = resolve; });
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => { release = resolve; });
  const execute = vi
    .spyOn(LocalDagRuntimeProvider.prototype, 'execute')
    .mockImplementation(async (_dag, _inputs, options) => {
      entered(options?.signal);
      await cleanup;
      throw new Error('late runtime cleanup failure');
    });
  try {
    const module = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
    });
    const command = module.systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });
    const started = await command.execute(context, 'run flow.json --detach');
    const runId = started.message.match(/Run ID: ([\w-]+)/)?.[1];
    expect(runId).toBeTruthy();
    const signal = await running;
    expect(signal).toBeInstanceOf(AbortSignal);

    let cancelFinished = false;
    const cancelling = Promise.resolve(command.execute(context, `cancel ${runId}`)).then((result) => {
      cancelFinished = true;
      return result;
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(cancelFinished).toBe(false);
    release();
    expect((await cancelling).success).toBe(true);

    const terminal = await command.execute(context, `status ${runId}`);
    expect(terminal.message).toContain('cancelled');
    expect(terminal.message).not.toContain('late runtime cleanup failure');
    await module.shutdown?.(context);
  } finally {
    release();
    execute.mockRestore();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['operator cancel', 'host shutdown'] as const)(
  '%s aborts a live prompt task and joins its cleanup',
  async (stop) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-detached-live-')));
    await mkdir(join(root, '.workflows', 'nodes'), { recursive: true });
    await writeFile(
      join(root, '.workflows', 'nodes', 'prompt.node.json'),
      JSON.stringify({
        kind: 'prompt',
        nodeType: 'held-prompt',
        displayName: 'Held prompt',
        systemPromptTemplate: '{{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
        provider: 'test',
      }),
    );
    await writeFile(
      join(root, 'flow.json'),
      JSON.stringify({
        dagId: 'held',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
          { nodeId: 'prompt', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
        ],
        edges: [
          { from: 'source', to: 'prompt', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        ],
      }),
    );
    let entered!: (signal: AbortSignal) => void;
    const providerEntered = new Promise<AbortSignal>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const held = new Promise<TUniversalMessage>((resolve) => {
      release = () => resolve(createAssistantMessage('late success'));
    });
    const provider: IAIProvider = {
      name: 'test',
      version: 'test',
      supportsTools: () => false,
      validateConfig: () => true,
      chat: async (_messages, options) => {
        if (!options?.signal) throw new Error('Missing task cancellation signal');
        entered(options.signal);
        return held;
      },
      generateResponse: async () => ({ content: 'unused' }),
    };
    const definitions: IProviderDefinition[] = [
      {
        type: 'test',
        defaults: { model: 'test-model' },
        createProvider: () => provider,
      },
    ];
    try {
      const module = createWorkflowsCommandModule({
        project: await createWorkflowProjectFixture(root),
        providerDefinitions: definitions,
      });
      const command = module.systemCommands?.[0];
      if (!command) throw new Error('workflows command missing');
      const context = createTestCommandHost({ cwd: root });
      const started = await command.execute(context, 'run flow.json --detach');
      const runId = started.message.match(/Run ID: ([\w-]+)/)?.[1];
      expect(runId).toBeTruthy();
      const signal = await providerEntered;
      const stopping =
        stop === 'operator cancel'
          ? Promise.resolve(command.execute(context, `cancel ${runId}`))
          : module.shutdown?.(context);
      if (!stopping) throw new Error('workflow module shutdown missing');
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      let finished = false;
      void stopping.then(() => {
        finished = true;
      });
      expect(finished).toBe(false);
      release();
      await stopping;
      const terminal = await command.execute(context, `status ${runId}`);
      expect(terminal.message).toContain(
        stop === 'operator cancel' ? 'cancelled' : 'Unknown workflow run ID',
      );
      expect(terminal.message).not.toContain('late success');
    } finally {
      release();
      await rm(root, { recursive: true, force: true });
    }
  },
  10_000,
);

it('bounds simultaneous detached roots and terminal history without evicting active handles', async () => {
  const runs = new DetachedWorkflowRuns();
  const held = () =>
    runs.start(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => resolve({ success: false, message: 'cancelled' }),
            { once: true },
          );
        }),
    );
  const active = Array.from({ length: 4 }, held);
  expect(active.every((result) => result.success)).toBe(true);
  expect(held().message).toContain('Too many active detached workflow runs');
  const activeId = active[0]?.message.match(/Run ID: ([\w-]+)/)?.[1];
  expect((await runs.status(String(activeId))).message).toContain('running');
  await runs.shutdown();

  const history = new DetachedWorkflowRuns();
  const ids: string[] = [];
  for (let index = 0; index < 101; index++) {
    const started = history.start(async () => ({ success: true, message: 'done' }));
    ids.push(started.message.match(/Run ID: ([\w-]+)/)?.[1] ?? '');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(history.status(ids[index] ?? '').message).toContain('completed');
  }
  expect(history.status(ids[0] ?? '').message).toContain('Unknown workflow run ID');
  expect(history.status(ids[100] ?? '').message).toContain('completed');
});

it('retains a bounded terminal result even when a workflow returns large output', async () => {
  const runs = new DetachedWorkflowRuns();
  const started = runs.start(async () => ({
    success: true,
    message: `Outputs: ${'😀'.repeat(10_000)}`,
  }));
  const id = started.message.match(/Run ID: ([\w-]+)/)?.[1] ?? '';
  await new Promise<void>((resolve) => setImmediate(resolve));
  const status = runs.status(id);
  expect(status.message).toContain('completed');
  expect(status.message).toContain('truncated');
  expect(status.message).not.toContain('\uFFFD');
  expect(Buffer.byteLength(status.message, 'utf8')).toBeLessThan(17_000);
});
