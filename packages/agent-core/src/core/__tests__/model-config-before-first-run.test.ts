/**
 * CORE-047 — the model-configuration API must be reachable before the first turn.
 *
 * `getModel()`, `setModel()` and `swapDefaultProvider()` refused unless the agent was "fully
 * initialized", and the state they guarded — the provider registry and the current (provider, model)
 * pair — was established inside the ASYNC initializer, next to genuinely async work (modules,
 * plugins, the execution service), even though both steps are synchronous and derived entirely from
 * config the constructor has already validated.
 *
 * They are now done by the constructor, which makes "an agent knows which model it is configured
 * for from the moment it exists" true by construction. That is the same conclusion CORE-045 reached
 * for `registerTool`, arrived at for a different reason: there, the guarded work did not exist;
 * here, it existed but was in the wrong place.
 *
 * `Robota.ensureReady()` remains the way to complete the genuinely asynchronous half, and is still
 * required before a turn runs. It is not required to ask which model you are using.
 */

import { describe, expect, it } from 'vitest';

import { Robota } from '../robota';

import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider } from '../../interfaces/provider';

function createProvider(name: string): IAIProvider {
  return {
    name,
    version: '1.0.0',
    async chat(): Promise<TUniversalMessage> {
      return {
        id: `${name}-1`,
        role: 'assistant',
        content: name,
        state: 'complete',
        timestamp: new Date(),
      };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async *chatStream(): AsyncGenerator<TUniversalMessage> {
      yield* [];
      throw new Error('chatStream is not exercised by this scenario');
    },
    supportsTools: () => false,
    validateConfig: () => true,
    async dispose(): Promise<void> {},
  } as unknown as IAIProvider;
}

function buildAgent(): Robota {
  return new Robota({
    name: 'core-047',
    aiProviders: [createProvider('primary')],
    defaultModel: { provider: 'primary', model: 'primary-model', temperature: 0.5 },
  });
}

describe('CORE-047 — the model API answers from construction', () => {
  it('getModel() returns the configured model with no prior run', async () => {
    const agent = buildAgent();
    try {
      expect(agent.getModel()).toEqual({
        provider: 'primary',
        model: 'primary-model',
        temperature: 0.5,
      });
    } finally {
      await agent.destroy();
    }
  });

  it('setModel() takes effect with no prior run, and getModel() reads it back', async () => {
    const agent = buildAgent();
    try {
      agent.setModel({ provider: 'primary', model: 'a-different-model' });
      expect(agent.getModel().model).toBe('a-different-model');
    } finally {
      await agent.destroy();
    }
  });

  it('swapDefaultProvider() registers and selects a replacement with no prior run', async () => {
    const agent = buildAgent();
    try {
      agent.swapDefaultProvider(createProvider('replacement'), 'swapped-model');
      // Tuning survives the swap. `swapDefaultProvider` changes WHERE the turn goes, not how the
      // model is asked to behave, so silently dropping the configured temperature would be a
      // second, unrequested change.
      expect(agent.getModel()).toEqual({
        provider: 'replacement',
        model: 'swapped-model',
        temperature: 0.5,
      });
    } finally {
      await agent.destroy();
    }
  });

  it('the swapped provider is the one the first turn actually goes to', async () => {
    // The point of reaching the API before a run is to change where the run goes. Asserting only
    // that `getModel()` reports the new name would pass on a config write that never reached the
    // provider registry.
    const agent = buildAgent();
    try {
      agent.swapDefaultProvider(createProvider('replacement'), 'swapped-model');
      await expect(agent.run('anything')).resolves.toBe('replacement');
    } finally {
      await agent.destroy();
    }
  });

  it('an unregistered provider is still rejected, and names what is available', async () => {
    const agent = buildAgent();
    try {
      expect(() => agent.setModel({ provider: 'never-registered', model: 'm' })).toThrow(
        /not found/,
      );
    } finally {
      await agent.destroy();
    }
  });

  it('a DESTROYED agent refuses, and says destroyed rather than "not initialized"', async () => {
    // Required by the item: the surviving refusal must diagnose the real state. Before this change
    // a destroyed agent reported "Agent must be fully initialized before getting model
    // configuration", which sent the reader looking for a missing await that does not exist.
    const agent = buildAgent();
    await agent.destroy();

    expect(() => agent.getModel()).toThrow(/disposed/i);
    expect(() => agent.getModel()).not.toThrow(/initialized/i);
  });
});
