import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AbstractAIProvider, Robota, type IChatOptions, type TUniversalMessage } from '@robota-sdk/agent-core';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

describe('local provider active cancellation', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('settles a hung prompt promptly after its run is cancelled', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-active-cancel-')));
    roots.push(root);
    let releaseProvider: () => void = () => undefined;
    const providerHeld = new Promise<void>((resolve) => { releaseProvider = resolve; });
    let chatEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { chatEntered = resolve; });
    let providerSignal: AbortSignal | undefined;
    class HungProvider extends AbstractAIProvider {
      readonly name = 'hung';
      readonly version = '1';
      async chat(_messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
        providerSignal = options?.signal;
        chatEntered();
        await providerHeld;
        return { id: 'late', role: 'assistant', content: 'late', state: 'complete', timestamp: new Date() };
      }
      override async *chatStream(): AsyncIterable<TUniversalMessage> { yield await this.chat([]); }
    }
    const agent = new Robota({
      name: 'prompt', aiProviders: [new HungProvider()],
      defaultModel: { provider: 'hung', model: 'test' },
      logging: { level: 'silent', enabled: false },
    });
    const node: IDagNodeDefinition = {
      nodeType: 'test/prompt', displayName: 'Prompt', category: 'test',
      inputs: [], outputs: [{ key: 'text', type: 'string', required: true }],
      configSchemaDefinition: null,
      taskHandler: { async execute(_input, context) {
        const text = await agent.run('prompt', { signal: context.signal });
        return { ok: true, value: { text } };
      } },
    };
    const definition: IDagDefinition = {
      dagId: 'prompt-abort', version: 1, status: 'draft',
      nodes: [{ nodeId: 'prompt', nodeType: 'test/prompt', dependsOn: [], config: {} }], edges: [],
    };
    const controller = new AbortController();
    const provider = new LocalDagRuntimeProvider({ executionRoot: root, nodeRegistry: [node] });
    const work = provider.execute(definition, {}, { signal: controller.signal });
    try {
      await entered;
      controller.abort();
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('cancellation did not settle promptly')), 500)),
      ]);
      expect(result.ok).toBe(false);
      expect(result.outputs).toEqual({});
      expect(providerSignal?.aborted).toBe(true);
    } finally {
      releaseProvider();
      await work;
    }
  });
});
