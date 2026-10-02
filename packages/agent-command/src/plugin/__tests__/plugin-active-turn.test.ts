import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import { createPluginCommandModule } from '../plugin-command-module.js';

async function heldTurn(denyRemote = false, commandModules = [createPluginCommandModule()]) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-active-turn-'));
  let release!: (value: TUniversalMessage) => void;
  const pending = new Promise<TUniversalMessage>((resolve) => { release = resolve; });
  const run = vi.fn(() => pending);
  const adapter: ICommandPluginAdapter = {
    listInstalled: async () => [], listAvailablePlugins: async () => [],
    install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}),
    enable: vi.fn(async () => {}), disable: vi.fn(async () => {}),
    marketplaceAdd: async () => 'fixture', marketplaceRemove: async () => {},
    marketplaceUpdate: async () => {}, marketplaceList: async () => [],
    reloadPlugins: async () => ({ loadedPluginCount: 0 }),
  };
  const session = new InteractiveSession({
    cwd: root, bare: true, environment: { HOME: root },
    provider: { name: 'held-provider', version: '1', chat: run } as unknown as IAIProvider,
    config: {
      provider: { name: 'held-provider', model: 'fixture-model', apiKey: undefined },
      defaultTrustLevel: 'safe', permissions: { allow: [], deny: [] }, env: {},
    },
    commandModules,
    commandHostAdapters: { plugin: adapter },
    ...(denyRemote ? { remoteCommandPolicy: { isAllowed: () => false } } : {}),
  });
  const submission = session.submit('Hold this fixture turn until its owner releases it.');
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  return {
    session, adapter,
    close: async () => {
      release({ id: 'held-response', role: 'assistant', state: 'complete', content: 'Finished', timestamp: new Date() });
      try { await (await submission).completed; } finally {
        await session.shutdown();
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

describe.each(['user', 'remote'] as const)('plugin withdrawal during a %s command', (source) => {
  it.each(['disable', 'uninstall'] as const)('allows %s while an admitted turn remains active', async (operation) => {
    const owned = await heldTurn();
    try {
      const result = await owned.session.executeCommand('plugin', `${operation} fixture@market`, source);
      expect(result?.success).toBe(true);
      expect(owned.adapter[operation]).toHaveBeenCalledExactlyOnceWith('fixture@market');
      expect(owned.session.isExecuting()).toBe(true);
    } finally { await owned.close(); }
  });

  it.each(['enable', 'install'] as const)('keeps %s behind the active-turn gate', async (operation) => {
    const owned = await heldTurn();
    try {
      const result = await owned.session.executeCommand('plugin', `${operation} fixture@market`, source);
      expect(result?.success).toBe(false);
      expect(result?.message).toContain('already running');
      expect(owned.adapter[operation]).not.toHaveBeenCalled();
    } finally { await owned.close(); }
  });
});

it('preserves remote policy and model refusal for active-turn withdrawal', async () => {
  const owned = await heldTurn(true);
  try {
    const result = await owned.session.executeCommand('plugin', 'disable fixture@market', 'remote');
    expect(result?.success).toBe(false);
    expect(result?.message).toContain('configured remote-command policy');
    for (const operation of ['disable', 'uninstall'] as const) {
      expect(await owned.session.executeModelCommand('plugin', `${operation} fixture@market`)).toBeNull();
      expect(owned.adapter[operation]).not.toHaveBeenCalled();
    }
  } finally { await owned.close(); }
});

it.each(['inline', 'blocking'] as const)('honors generic host control metadata only for %s lifecycle', async (lifecycle) => {
  const execute = vi.fn(() => ({ success: true, message: 'Control applied' }));
  const owned = await heldTurn(false, [{
    name: 'fixture-control', systemCommands: [{
      name: 'withdraw-fixture', description: 'Owner fixture control', lifecycle,
      canRunDuringTurn: (args) => args === 'stop', modelInvocable: false, execute,
    }],
  }]);
  try {
    const refused = await owned.session.executeCommand('withdraw-fixture', 'start');
    expect(refused?.success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    const result = await owned.session.executeCommand('withdraw-fixture', 'stop');
    expect(result?.success).toBe(lifecycle === 'inline');
    expect(execute).toHaveBeenCalledTimes(lifecycle === 'inline' ? 1 : 0);
    expect(owned.session.isExecuting()).toBe(true);
  } finally { await owned.close(); }
});
