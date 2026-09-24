import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import { expect, it, vi } from 'vitest';

import { createWorkflowsCommandModule } from '../workflows-command-module.js';
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
    const command = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
    }).systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });
    const started = await command.execute(context, 'run flow.json --detach');
    expect(started.success).toBe(true);
    const runId = started.message.match(/Run ID: ([\w-]+)/)?.[1];
    expect(runId).toBeTruthy();
    await running;
    const active = await command.execute(context, `status ${runId}`);
    expect(active.message).toContain('running');
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
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    execute.mockRestore();
  }
});

it('cancels a live prompt task and cannot publish its late success', async () => {
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
    const command = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
      providerDefinitions: definitions,
    }).systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });
    const started = await command.execute(context, 'run flow.json --detach');
    const runId = started.message.match(/Run ID: ([\w-]+)/)?.[1];
    expect(runId).toBeTruthy();
    const signal = await providerEntered;
    const cancelling = command.execute(context, `cancel ${runId}`);
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect((await command.execute(context, `status ${runId}`)).message).toContain('running');
    release();
    expect((await cancelling).message).toContain('cancelled');
    const terminal = await command.execute(context, `status ${runId}`);
    expect(terminal.message).toContain('cancelled');
    expect(terminal.message).not.toContain('late success');
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);
