import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AbstractAIProvider, Robota, type IChatOptions, type TUniversalMessage } from '@robota-sdk/agent-core';
import { RootCreditBudget } from '@robota-sdk/dag-core';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

describe('local provider active cancellation', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('seals inherited root credits while waiting for an aborted provider to settle', async () => {
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
        const text = await agent.run('prompt', { signal: context.signal, awaitProviderSettlement: true });
        return { ok: true, value: { text } };
      } },
    };
    const definition: IDagDefinition = {
      dagId: 'prompt-abort', version: 1, status: 'draft',
      nodes: [{ nodeId: 'prompt', nodeType: 'test/prompt', dependsOn: [], config: {} }], edges: [],
    };
    const controller = new AbortController();
    const rootCredits = new RootCreditBudget(1);
    const provider = new LocalDagRuntimeProvider({
      executionRoot: root,
      nodeRegistry: [node],
      rootCreditBudget: rootCredits,
    });
    const work = provider.execute(definition, {}, { signal: controller.signal });
    try {
      await entered;
      controller.abort();
      let completed = false;
      void work.then(() => { completed = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(providerSignal?.aborted).toBe(true);
      expect(completed).toBe(false);
      // An inherited root authority must stop admitting sibling work as soon as
      // this child run's cancellation commits, before its provider finishes cleanup.
      expect(rootCredits.reserve(0.1)).toMatchObject({
        ok: false,
        error: { code: 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED' },
      });
      releaseProvider();
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
