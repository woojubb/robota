/**
 * #3231: the TUI builds a new channel on every session switch, and it may do so before the old
 * session's turn has ended. A checkpoint store holds one turn in progress, so a store shared across
 * channels would let the old turn close the new session's turn. Each channel gets its own.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInProcessChannelFactory } from '../render.js';
import { TerminalHandoffController } from '../terminal-handoff-controller.js';

import type { IChannelServices, IRenderOptions } from '../render.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { ITuiAppChannelPort } from '../tui-app-channel-port.js';
import type { EditCheckpointStore } from '@robota-sdk/agent-framework';

const sessionStores = vi.hoisted(() => [] as unknown[]);

vi.mock('../tui-session-options.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tui-session-options.js')>();
  return {
    buildTuiSessionOptions: (
      ...args: Parameters<typeof original.buildTuiSessionOptions>
    ): ReturnType<typeof original.buildTuiSessionOptions> => {
      const built = original.buildTuiSessionOptions(...args);
      sessionStores.push(built.editCheckpointStore);
      return built;
    },
  };
});

function fakeCliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: () => ({}),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

describe('#3231: the in-process channel factory', () => {
  const channels: ITuiAppChannelPort[] = [];
  let cwd: string | undefined;

  afterEach(async () => {
    for (const channel of channels.splice(0)) await channel.stop();
    sessionStores.splice(0);
    if (cwd !== undefined) rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('gives each channel, including a switched-to one, its own checkpoint store', () => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-store-per-channel-')));
    const createEditCheckpointStore = vi.fn(() => ({}) as EditCheckpointStore);
    const options: IRenderOptions = {
      cwd,
      provider: createScriptedProvider([{ text: 'unused' }]).provider,
      cliAdapter: fakeCliAdapter(join(cwd, 'settings.json')),
      createEditCheckpointStore,
    };
    const services = {
      terminalHandoff: new TerminalHandoffController(),
    } as unknown as IChannelServices;
    const createChannel = createInProcessChannelFactory(options, services);

    channels.push(createChannel(), createChannel('switched-to-session'));

    expect(createEditCheckpointStore).toHaveBeenCalledTimes(2);
    expect(sessionStores).toHaveLength(2);
    expect(sessionStores[0]).toBeDefined();
    expect(sessionStores[1]).toBeDefined();
    expect(sessionStores[0]).not.toBe(sessionStores[1]);
  });
});
