import { describe, expect, it, vi } from 'vitest';
import { ConversationAgent, type IAgentConfig } from '../../index';
import { ModuleCategory, ModuleLayer } from '../../abstracts/abstract-module';
import { createScriptedProvider } from '../../testing/scripted-provider';

function client() {
  const scripted = createScriptedProvider([{ text: 'still available' }]);
  const chat = scripted.provider.chat.bind(scripted.provider);
  const close = vi.fn(async () => {});
  const provider = Object.assign(scripted.provider, {
    close,
    chat: (...args: Parameters<typeof chat>) => {
      if (close.mock.calls.length) throw new Error('provider closed');
      return chat(...args);
    },
  });
  return { provider, close };
}

function config(provider: IAgentConfig['aiProviders'][number]): IAgentConfig {
  return {
    name: 'borrower',
    aiProviders: [provider],
    defaultModel: { provider: provider.name, model: 'fixture' },
    logging: { enabled: false },
  };
}

describe('provider lifetime through the public agent', () => {
  it('keeps a borrowed provider usable by a config copy until the external owner closes it', async () => {
    const { provider, close } = client();
    const first = new ConversationAgent({
      ...config(provider),
      providerOwnership: { [provider.name]: 'borrowed' },
    });
    const second = new ConversationAgent(first.getConfig());
    try {
      await first.destroy();
      expect(close).not.toHaveBeenCalled();
      expect(await second.run('continue')).toBe('still available');
    } finally {
      await first.destroy();
      await second.destroy();
    }
    expect(close).not.toHaveBeenCalled();
    await provider.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('owns providers by default and closes them once across repeated destruction', async () => {
    const { provider, close } = client();
    const agent = new ConversationAgent(config(provider));
    await Promise.all([agent.destroy(), agent.destroy()]);
    await agent.destroy();
    expect(close).toHaveBeenCalledOnce();
  });

  it('snapshots mixed ownership at registration', async () => {
    const borrowed = client();
    const owned = client();
    const ownedProvider = { ...owned.provider, name: 'owned-fixture' };
    const ownership = { [borrowed.provider.name]: 'borrowed' as const };
    const agent = new ConversationAgent({
      ...config(borrowed.provider),
      aiProviders: [borrowed.provider, ownedProvider],
      providerOwnership: ownership,
    });
    Reflect.set(ownership, borrowed.provider.name, 'owned');
    await agent.destroy();
    expect(borrowed.close).not.toHaveBeenCalled();
    expect(owned.close).toHaveBeenCalledOnce();
  });

  it('rejects unknown registrations and invalid ownership at construction', () => {
    const { provider } = client();
    expect(
      () =>
        new ConversationAgent({
          ...config(provider),
          providerOwnership: { unknown: 'borrowed' },
        }),
    ).toThrow(/ownership|registered/i);
    const invalid = config(provider);
    Reflect.set(invalid, 'providerOwnership', { [provider.name]: 'shared' });
    expect(() => new ConversationAgent(invalid)).toThrow(/ownership/i);
  });

  it('tracks swapped providers and their explicit ownership in the public configuration', async () => {
    const previous = client();
    const replacement = client();
    const agent = new ConversationAgent(config(previous.provider));
    agent.swapDefaultProvider(replacement.provider, 'replacement', { ownership: 'borrowed' });
    expect(agent.getConfig().aiProviders).toEqual([replacement.provider]);
    expect(agent.getConfig().providerOwnership).toEqual({
      [replacement.provider.name]: 'borrowed',
    });
    await agent.destroy();
    expect(previous.close).toHaveBeenCalledOnce();
    expect(replacement.close).not.toHaveBeenCalled();
  });

  it('does not treat inherited object properties as ownership declarations', async () => {
    const borrowed = client();
    const owned = client();
    const named = { ...owned.provider, name: 'toString' };
    const agent = new ConversationAgent({
      ...config(borrowed.provider),
      aiProviders: [borrowed.provider, named],
      providerOwnership: { [borrowed.provider.name]: 'borrowed' },
    });
    await agent.destroy();
    expect(owned.close).toHaveBeenCalledOnce();
    expect(borrowed.close).not.toHaveBeenCalled();
  });

  it.each([null, [], new Date(), 'borrowed'])(
    'rejects an invalid ownership container: %s',
    (value) => {
      const { provider } = client();
      const invalid = config(provider);
      Reflect.set(invalid, 'providerOwnership', value);
      expect(() => new ConversationAgent(invalid)).toThrow(/ownership/i);
    },
  );

  it('preserves a borrowed provider after initialization and execution failures', async () => {
    const { provider, close } = client();
    const brokenModule: NonNullable<IAgentConfig['modules']>[number] = {
      name: 'broken',
      version: '1',
      enabled: true,
      async initialize() {
        throw new Error('module failed');
      },
      getModuleType: () => ({
        type: 'broken',
        category: ModuleCategory.CORE,
        layer: ModuleLayer.CORE,
      }),
      getCapabilities: () => ({ capabilities: [] }),
      isEnabled: () => true,
      isInitialized: () => false,
    };
    const initialization = new ConversationAgent({
      ...config(provider),
      providerOwnership: { [provider.name]: 'borrowed' },
      modules: [brokenModule],
    });
    await expect(initialization.run('initialize')).rejects.toThrow('module failed');
    await initialization.destroy();
    expect(close).not.toHaveBeenCalled();
    const failing = {
      ...provider,
      async chat(): Promise<never> {
        throw new Error('call failed');
      },
    };
    const execution = new ConversationAgent({
      ...config(failing),
      providerOwnership: { [failing.name]: 'borrowed' },
    });
    await expect(execution.run('fail')).rejects.toThrow('call failed');
    await execution.destroy();
    expect(close).not.toHaveBeenCalled();
    expect(await provider.chat([])).toMatchObject({ content: 'still available' });
  });
});
