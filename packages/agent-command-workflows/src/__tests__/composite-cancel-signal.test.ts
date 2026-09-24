import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import type { IAIProvider, IProviderDefinition, TUniversalMessage } from '@robota-sdk/agent-core';
import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeSavedComposite(root: string): void {
  mkdirSync(join(root, '.workflows/nodes'), { recursive: true });
  writeFileSync(
    join(root, '.workflows/nodes/prompt.node.json'),
    JSON.stringify({
      kind: 'prompt', nodeType: 'held-prompt', displayName: 'Held prompt',
      systemPromptTemplate: '{{text}}', inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' }, provider: 'test',
    }),
  );
  writeFileSync(
    join(root, '.workflows/nodes/wrap.node.json'),
    JSON.stringify({
      kind: 'composite', nodeType: 'wrap', displayName: 'Wrap',
      innerDag: {
        dagId: 'child', version: 1, status: 'draft',
        nodes: [
          { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
          { nodeId: 'prompt', nodeType: 'held-prompt', dependsOn: ['source'], timeoutMs: 5_000, config: {} },
        ],
        edges: [{ from: 'source', to: 'prompt', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
      },
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'source', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'text', mapsTo: { nodeId: 'prompt', portKey: 'text' } }],
    }),
  );
  writeFileSync(
    join(root, 'parent.json'),
    JSON.stringify({
      dagId: 'parent', version: 1, status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
        { nodeId: 'wrapped', nodeType: 'wrap', dependsOn: ['source'], timeoutMs: 1_500, config: {} },
      ],
      edges: [{ from: 'source', to: 'wrapped', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
    }),
  );
}

function observeAbort(signal: AbortSignal, timeoutMs: number): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

it.each(['resolve', 'reject'] as const)('/workflows parent timeout joins child provider cleanup and discards its late %s', async (outcome) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-child-cancel-')));
  roots.push(root);
  vi.stubEnv('HOME', root);
  writeSavedComposite(root);

  let entered!: (signal: AbortSignal) => void;
  const providerEntered = new Promise<AbortSignal>((resolve) => { entered = resolve; });
  let release!: () => void;
  const held = new Promise<TUniversalMessage>((resolve, reject) => {
    release = () => outcome === 'reject'
      ? reject(new Error('late provider failure'))
      : resolve(createAssistantMessage('done'));
  });
  const provider: IAIProvider = {
    name: 'test', version: 'test', supportsTools: () => false,
    validateConfig: () => true,
    chat: async (_messages, options) => {
      if (!options?.signal) throw new Error('Expected child provider signal');
      entered(options.signal);
      return held;
    },
    generateResponse: async () => ({ content: 'unused' }),
  };
  const definitions: IProviderDefinition[] = [{
    type: 'test', defaults: { model: 'test-model' }, createProvider: () => provider,
  }];

  try {
    const project = await createWorkflowProjectFixture(root);
    const run = executeWorkflowsRun('parent.json', project, undefined, definitions);
    let completed = false;
    void run.then(() => { completed = true; });
    const signal = await providerEntered;
    expect(await observeAbort(signal, 3_000)).toBe(true);
    // The provider has observed cancellation but still owns cleanup until it settles.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completed).toBe(false);
    release();
    const result = await run;
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/timeout|timed out/i);
    expect(await observeAbort(signal, 700)).toBe(true);
  } finally {
    release();
  }
}, 10_000);
