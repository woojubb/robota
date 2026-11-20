import { describe, expect, it, vi } from 'vitest';
import { ConversationAgent } from '../conversation-agent';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import { createProviderFromConfig } from '../../providers/provider-factory';
import type { IManagedRunProvider } from '../../interfaces/managed-provider';
import type { IAIProvider, IProviderDefinition } from '../../interfaces';

function managedProvider() {
  const run = vi.fn<IManagedRunProvider['run']>();
  const close = vi.fn(async () => {});
  const provider: IManagedRunProvider = {
    kind: 'managed-run',
    name: 'managed-test',
    version: 'test',
    run,
    close,
    validateConfig: () => true,
  };
  return { provider, run, close };
}

describe('provider execution contract', () => {
  it('registers a managed provider but refuses the turn before provider or tool effects', async () => {
    const { provider, run, close } = managedProvider();
    const fromDefinition = createProviderFromConfig({ name: provider.name, model: 'test-model' }, [
      { type: provider.name, createProvider: () => provider },
    ]);
    expect(fromDefinition).toBe(provider);
    const execute = vi.fn(async () => 'tool result');
    const agent = new ConversationAgent({
      name: 'managed-contract',
      aiProviders: [provider],
      defaultModel: { provider: provider.name, model: 'test-model' },
      tools: [
        new FunctionTool(
          {
            name: 'effect',
            description: 'test effect',
            parameters: { type: 'object', properties: {} },
          },
          execute,
        ),
      ],
    });
    const before = agent.getHistory();
    try {
      await expect(agent.run('hello')).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      const streamed = async () => {
        for await (const _chunk of agent.runStream('hello')) {
          // Consume the complete stream.
        }
      };
      await expect(streamed()).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      expect(run).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(agent.getHistory()).toEqual(before);
    } finally {
      await agent.destroy();
    }
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps legacy one-step providers usable after switching from a managed provider', async () => {
    const { provider, run } = managedProvider();
    const scripted = createScriptedProvider([{ text: 'model-step answer' }]);
    const definition: IProviderDefinition = {
      type: scripted.provider.name,
      createProvider: () => scripted.provider,
    };
    const stepProvider: IAIProvider = createProviderFromConfig(
      { name: scripted.provider.name, model: 'test-model' },
      [definition],
    );
    const agent = new ConversationAgent({
      name: 'compatibility',
      aiProviders: [provider],
      defaultModel: { provider: provider.name, model: 'test-model' },
    });
    try {
      await expect(agent.run('first')).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      agent.swapDefaultProvider(stepProvider, 'test-model');
      await expect(agent.run('second')).resolves.toBe('model-step answer');
      expect(run).not.toHaveBeenCalled();
      expect(scripted.requests).toHaveLength(1);
    } finally {
      await agent.destroy();
    }
  });
});
