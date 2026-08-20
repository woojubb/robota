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

import { Robota } from '../robota.js';

import type { IAgentConfig } from '../../interfaces/agent.js';

function agent(): Robota {
  return new Robota({
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
    const robota = agent();
    expect(robota.name).toBe('before');

    await robota.updateConfiguration({ name: 'after' });

    expect(robota.name).toBe('after');
  });

  it('keeps `getConfig()` in step with `name`', async () => {
    // The half a copied field breaks: before ARCH-040 the instance held its own `name`, so a config
    // write moved one reader and not the other. Asserting both is what rules that out.
    const robota = agent();
    await robota.updateConfiguration({ name: 'after' });

    expect(robota.getConfig().name).toBe('after');
    expect(robota.getConfig().name).toBe(robota.name);
  });

  it('leaves the rest of the config alone', async () => {
    const robota = agent();
    await robota.updateConfiguration({ name: 'after' });

    expect(robota.getConfig().systemMessage).toBe('test');
    expect(robota.getConfig().defaultModel.model).toBe('mock-model');
  });

  it('still refuses a patch it does not support', async () => {
    // The seam stays narrow. Accepting `name` must not turn `updateConfiguration` into a general
    // config setter, which is what the original error was guarding.
    const robota = agent();
    await expect(
      robota.updateConfiguration({ systemMessage: 'nope' } as Partial<IAgentConfig>),
    ).rejects.toThrow(/only .tools. and .name./);
  });
});
