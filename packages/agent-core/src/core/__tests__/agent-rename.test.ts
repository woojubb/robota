/**
 * ARCH-040 (issue #1820) — an agent can be renamed while it is live.
 *
 * A preset carries `agentName`, and it reached the agent only at construction: starting with a
 * preset set the name while switching to the SAME preset mid-session left the old one. One preset,
 * two answers, decided by WHEN it was chosen.
 *
 * `name` reads THROUGH `config` now, so `updateConfiguration({ name })` is the whole rename. These
 * assert that every reader agrees afterwards — a rename that moved one and not the others would be
 * the divergence with extra steps, which is exactly what a copied field on the instance produced.
 */

import { describe, expect, it } from 'vitest';

import { ConversationAgent } from '../conversation-agent.js';

import type { IAgentConfig } from '../../interfaces/agent.js';

function makeAgent(): ConversationAgent {
  return new ConversationAgent({
    name: 'before',
    aiProviders: [
      { name: 'mock', version: '1', chat: async () => ({}), supportsTools: () => true },
    ],
    defaultModel: { provider: 'mock', model: 'mock-model' },
    systemMessage: 'test',
  } as unknown as IAgentConfig);
}

describe('renaming a live agent (ARCH-040)', () => {
  it('changes what `name` reports', async () => {
    const agent = makeAgent();
    expect(agent.name).toBe('before');

    await agent.updateConfiguration({ name: 'after' });

    expect(agent.name).toBe('after');
  });

  it('keeps `getConfig()` in step with `name`', async () => {
    // The half a copied field breaks: before ARCH-040 the instance held its own `name`, so a config
    // write moved one reader and not the other. Asserting both is what rules that out.
    const agent = makeAgent();
    await agent.updateConfiguration({ name: 'after' });

    expect(agent.getConfig().name).toBe('after');
    expect(agent.getConfig().name).toBe(agent.name);
  });

  it('leaves the rest of the config alone', async () => {
    const agent = makeAgent();
    await agent.updateConfiguration({ name: 'after' });

    expect(agent.getConfig().systemMessage).toBe('test');
    expect(agent.getConfig().defaultModel.model).toBe('mock-model');
  });

  it('still refuses a patch it does not support', async () => {
    // The seam stays narrow. Accepting `name` must not turn `updateConfiguration` into a general
    // config setter, which is what the original error was guarding.
    const agent = makeAgent();
    await expect(
      agent.updateConfiguration({ systemMessage: 'nope' } as Partial<IAgentConfig>),
    ).rejects.toThrow(/only .tools. and .name./);
  });
});
