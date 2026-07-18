import { describe, expect, it } from 'vitest';

import { AbstractAIProvider } from '../../abstracts/abstract-ai-provider';
import { Robota } from '../../core/robota';
import { createScriptedProvider } from '../../testing/scripted-provider';

import type { IAgentConfig } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';

/**
 * SELFHOST-008 P3 — TC-03: the agent-core EPHEMERAL system-context seam.
 *
 * `IRunOptions.ephemeralSystemContext` must reach the provider request as a transient system-role
 * message for THAT run only, and MUST NOT be written to the conversation store (never persisted to
 * history, no static-system-prompt rebuild). A run without it is unchanged.
 */

const EPHEMERAL =
  '<recalled-memory>The staging deploy key rotates every 30 days (SEC-014).</recalled-memory>';

function createConfig(
  providerName: string,
  provider: IAgentConfig['aiProviders'][number],
): IAgentConfig {
  return {
    name: 'Ephemeral Seam Test Agent',
    aiProviders: [provider],
    defaultModel: { provider: providerName, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
  };
}

describe('SELFHOST-008 P3 TC-03 — ephemeral system-context seam (agent-core)', () => {
  it('reaches the provider request as a system message but is NOT persisted to the conversation store', async () => {
    const scripted = createScriptedProvider([{ text: 'done' }]);
    const robota = new Robota(createConfig('scripted-test-provider', scripted.provider));

    await robota.run('rotate the staging key', { ephemeralSystemContext: EPHEMERAL });

    // (a) the provider saw the ephemeral block as a system message this call
    expect(scripted.requests).toHaveLength(1);
    const sentSystemBlocks = scripted.requests[0].filter((m) => m.role === 'system');
    expect(sentSystemBlocks.some((m) => m.content === EPHEMERAL)).toBe(true);

    // (b) it is absent from the persisted conversation store (never addUserMessage/addMessage'd)
    const persisted = robota.getHistory();
    expect(persisted.some((m) => (m.content ?? '').includes('recalled-memory'))).toBe(false);
    expect(persisted.some((m) => (m.content ?? '').includes('staging deploy key'))).toBe(false);
  });

  it('is a no-op when ephemeralSystemContext is absent (no extra system message)', async () => {
    const scripted = createScriptedProvider([{ text: 'done' }]);
    const robota = new Robota(createConfig('scripted-test-provider', scripted.provider));

    await robota.run('hello');

    expect(scripted.requests).toHaveLength(1);
    expect(scripted.requests[0].some((m) => m.content === EPHEMERAL)).toBe(false);
  });

  it('does not persist the block even across a second turn (ephemeral per-run only)', async () => {
    const scripted = createScriptedProvider([{ text: 'one' }, { text: 'two' }]);
    const robota = new Robota(createConfig('scripted-test-provider', scripted.provider));

    await robota.run('first', { ephemeralSystemContext: EPHEMERAL });
    await robota.run('second');

    // the 2nd call's request must not carry the 1st turn's ephemeral block (it was never stored)
    expect(scripted.requests).toHaveLength(2);
    expect(scripted.requests[1].some((m) => m.content === EPHEMERAL)).toBe(false);
    expect(robota.getHistory().some((m) => (m.content ?? '').includes('recalled-memory'))).toBe(
      false,
    );
  });
});

/** Streaming provider that captures the messages array each chatStream call received. */
class CapturingStreamProvider extends AbstractAIProvider {
  readonly name = 'capturing-stream-provider';
  readonly version = '1.0.0';
  streamCalls: TUniversalMessage[][] = [];

  async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
    return { id: 'x', role: 'assistant', content: 'ok', state: 'complete', timestamp: new Date() };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.streamCalls.push([...messages]);
    yield {
      id: 'c1',
      role: 'assistant',
      content: 'streamed',
      state: 'complete',
      timestamp: new Date(),
    };
  }
}

describe('SELFHOST-008 P3 — ephemeral seam on the runStream path (review SHOULD)', () => {
  it('runStream honors ephemeralSystemContext identically: reaches the provider, not persisted', async () => {
    const provider = new CapturingStreamProvider();
    const robota = new Robota({
      name: 'Ephemeral Stream Test Agent',
      aiProviders: [provider],
      defaultModel: { provider: 'capturing-stream-provider', model: 'test-model' },
      logging: { level: 'silent', enabled: false },
    });

    for await (const _chunk of robota.runStream('rotate the key', {
      ephemeralSystemContext: EPHEMERAL,
    })) {
      // consume
    }

    expect(provider.streamCalls).toHaveLength(1);
    expect(
      provider.streamCalls[0].some((m) => m.role === 'system' && m.content === EPHEMERAL),
    ).toBe(true);
    expect(robota.getHistory().some((m) => (m.content ?? '').includes('recalled-memory'))).toBe(
      false,
    );
  });
});
