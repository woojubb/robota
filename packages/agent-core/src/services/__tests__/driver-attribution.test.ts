import { describe, expect, it } from 'vitest';

import { Robota } from '../../core/robota';
import { createScriptedProvider } from '../../testing/scripted-provider';

import type { IAgentConfig } from '../../interfaces/agent';

/**
 * PEER-007 (issue #1915) — the DISPLAY-attribution seam in agent-core.
 *
 * `IRunOptions.driverId` must land on the stored user message, because the transcript is all a
 * reader has once the turn ends: without it a peer session's message is indistinguishable from the
 * operator's own. It is attribution only — issue #1809 settled that a driver id is never an
 * authorization input, and nothing here consults it to decide what the run may do.
 */

function createConfig(
  providerName: string,
  provider: IAgentConfig['aiProviders'][number],
): IAgentConfig {
  return {
    name: 'Driver Attribution Test Agent',
    aiProviders: [provider],
    defaultModel: { provider: providerName, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
  };
}

describe('PEER-007 — driverId reaches the stored user message', () => {
  it('stores the driver id on the user message it drove', async () => {
    const scripted = createScriptedProvider([{ text: 'done' }]);
    const robota = new Robota(createConfig('scripted-test-provider', scripted.provider));

    await robota.run('summarise the release notes', { driverId: 'peer:session-abc' });

    const user = robota.getHistory().find((m) => m.role === 'user');
    expect(user?.metadata?.driverId).toBe('peer:session-abc');
  });

  it('leaves the user message unattributed when no driver is given', async () => {
    const scripted = createScriptedProvider([{ text: 'done' }]);
    const robota = new Robota(createConfig('scripted-test-provider', scripted.provider));

    await robota.run('summarise the release notes');

    const user = robota.getHistory().find((m) => m.role === 'user');
    expect(user?.metadata?.driverId).toBeUndefined();
  });

  it('attributes each turn to ITS OWN driver rather than the first one seen', async () => {
    // The defect this pins: a driver carried on the agent config (or cached on the instance) would
    // stamp every later turn with the first turn's driver. Attribution is per-run.
    const scripted = createScriptedProvider([{ text: 'one' }, { text: 'two' }]);
    const robota = new Robota(createConfig('scripted-test-provider', scripted.provider));

    await robota.run('first', { driverId: 'peer:session-abc' });
    await robota.run('second', { driverId: 'owner' });

    const users = robota.getHistory().filter((m) => m.role === 'user');
    expect(users.map((m) => m.metadata?.driverId)).toEqual(['peer:session-abc', 'owner']);
  });
});
