import { describe, expect, it, vi } from 'vitest';
import { ConversationAgent } from '../conversation-agent';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import { createProviderFromConfig } from '../../providers/provider-factory';
import { findProviderDefinition } from '../../interfaces/provider-definition';
import { AIProviders } from '../../managers/ai-provider-manager';
import type {
  IManagedRunProvider,
  IModelStepProvider,
  TDiscriminatedExecutionProvider,
  TExecutionProvider,
} from '../../interfaces/managed-provider';
import type {
  IAIProvider,
  IAIProviderManager,
  IAgentConfig,
  IProviderDefinition,
} from '../../interfaces';

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
  it('refuses managed configuration changes without routing to the old provider', async () => {
    const step = createScriptedProvider([{ text: 'legacy answer' }]);
    const { provider: managed } = managedProvider();
    const config: IAgentConfig = {
      name: 'legacy',
      aiProviders: [step.provider],
      defaultModel: { provider: step.provider.name, model: 'legacy-model' },
    };
    const agent = new ConversationAgent(config);
    try {
      await expect(
        agent.configure({
          name: 'managed',
          aiProviders: [managed],
          defaultModel: { provider: managed.name, model: 'managed-model' },
        }),
      ).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      await expect(
        agent.updateConfiguration({
          name: 'changed',
          defaultModel: { provider: managed.name, model: 'managed-model' },
        }),
      ).rejects.toThrow(/only `tools` and `name`/);
      expect(agent.getModel()).toMatchObject({
        provider: step.provider.name,
        model: 'legacy-model',
      });
      expect(step.requests).toHaveLength(0);
      await expect(agent.run('hello')).resolves.toBe('legacy answer');
      expect(step.chatOptions[0]?.model).toBe('legacy-model');
    } finally {
      await agent.destroy();
    }
  });

  it('keeps model selection detached from caller-owned and returned configuration during a turn', async () => {
    const step = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chat = step.provider.chat.bind(step.provider);
    step.provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      if (step.requests.length === 1) {
        enter();
        await gate;
      }
      return response;
    };
    const config: IAgentConfig = {
      name: 'legacy',
      aiProviders: [step.provider],
      defaultModel: { provider: step.provider.name, model: 'legacy-model' },
      tools: [
        new FunctionTool(
          { name: 'act', description: 'action', parameters: { type: 'object', properties: {} } },
          async () => 'done',
        ),
      ],
    };
    const agent = new ConversationAgent(config);
    try {
      const running = agent.run('hello');
      await entered;
      try {
        for (const model of [
          config.defaultModel,
          agent.getConfig().defaultModel,
          agent.getExecutionConfig().defaultModel,
        ]) {
          model.provider = 'managed-test';
          model.model = 'managed-model';
        }
      } finally {
        release();
      }
      await expect(running).resolves.toBe('done');
      expect(step.chatOptions.map((options) => options?.model)).toEqual([
        'legacy-model',
        'legacy-model',
      ]);
      expect(agent.getModel()).toMatchObject({
        provider: step.provider.name,
        model: 'legacy-model',
      });
    } finally {
      await agent.destroy();
    }
  });

  it('preserves legacy registry and configuration reads alongside mixed execution access', async () => {
    const manager = new AIProviders();
    const legacy: IAIProviderManager = manager;
    const step = createScriptedProvider([{ text: 'answer' }]).provider;
    const { provider: managed } = managedProvider();
    legacy.addProvider(step.name, step);
    const getLegacyChat = (config: IAgentConfig) => config.aiProviders[0].chat;
    expect(
      getLegacyChat({
        name: 'legacy',
        aiProviders: [step],
        defaultModel: { provider: step.name, model: 'm' },
      }),
    ).toBe(step.chat);
    expect(legacy.getProvider(step.name)?.supportsTools()).toBe(true);
    expect(legacy.getProviders()[step.name]).toBe(step);
    manager.addProvider(managed.name, managed);
    expect(manager.getExecutionProvider(managed.name)).toBe(managed);
    expect(manager.getExecutionProviders()[managed.name]).toBe(managed);
    expect(() => legacy.getProvider(managed.name)).toThrow(/Managed execution is not available/);
    expect(() => legacy.getProviders()).toThrow(/Managed execution is not available/);
    await manager.dispose();
  });

  it('accepts heterogeneous registries and explicitly tagged model-step providers', () => {
    const step = createScriptedProvider([{ text: 'answer' }]).provider;
    const { provider: managed } = managedProvider();
    const tagged: IModelStepProvider = { ...step, kind: 'model-step' };
    const direct: TExecutionProvider = { ...step, kind: 'model-step' };
    const narrow = (provider: TDiscriminatedExecutionProvider) =>
      provider.kind === 'managed-run' ? provider.run : provider.chat;
    const heterogeneous = [
      { type: 'first', createProvider: () => ({ ...step, first: true }) },
      { type: 'second', createProvider: () => ({ ...step, second: true }) },
    ];
    const mixed = [...heterogeneous, { type: 'managed', createProvider: () => managed }];
    const legacyResult: IAIProvider = createProviderFromConfig(
      { name: 'first', model: 'm' },
      heterogeneous,
    );
    const mixedResult: TExecutionProvider = createProviderFromConfig(
      { name: 'managed', model: 'm' },
      mixed,
    );
    expect(findProviderDefinition(heterogeneous, 'second')?.type).toBe('second');
    expect(findProviderDefinition(mixed, 'managed')?.type).toBe('managed');
    expect(legacyResult.name).toBe(step.name);
    expect(mixedResult).toBe(managed);
    expect(narrow(tagged)).toBe(step.chat);
    expect(direct).toMatchObject({ kind: 'model-step' });
  });

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
      expect(agent.getExecutionConfig().aiProviders).toEqual([provider]);
      expect(() => agent.getConfig()).toThrow(/Managed execution is not available/);
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
