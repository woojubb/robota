/**
 * #3282 §4a: the Settings screen's server-side read/write. Every field but `language` applies
 * through `session.executeCommand` — the exact call a `/mode`, `/output-style`, `/preset` or
 * `/sandbox` command would make — so a refusal a command gives is the refusal the Settings screen
 * gives. `language` writes the same settings document `/language` writes, without its restart.
 *
 * Pure unit tests: every adapter is an in-memory fake, so nothing here touches a real filesystem or
 * `~/.robota` — there is nothing to point HOME at.
 */
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createSettingsReporter } from '../settings-reporter.js';

import type { ICreateSettingsReporterOptions } from '../settings-reporter.js';
import type {
  ICommandHostAdapters,
  ICommandSettingsAdapter,
  ISettingsDocumentStore,
  TSettingsData,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

function fakeSettingsAdapter(initial: TSettingsData = {}): ICommandSettingsAdapter {
  let data = initial;
  return {
    read: () => data,
    write: (next) => {
      data = next;
    },
  };
}

function fakeStore(
  scope: ISettingsDocumentStore['scope'],
  initial: TSettingsData,
): ISettingsDocumentStore {
  let data = initial;
  return {
    kind: scope === 'user' ? 'host' : 'project',
    scope,
    displayName: `${scope}.json`,
    source: { kind: 'host', scope: 'user' } as unknown as ISettingsDocumentStore['source'],
    read: () => data,
    write: (next) => {
      data = next;
    },
  };
}

function setup(options: {
  executeCommand?: IProtocolSession['executeCommand'];
  permissionMode?: string;
  commandHostAdapters?: Partial<ICommandHostAdapters>;
  settingsSources?: ICreateSettingsReporterOptions['settingsSources'];
  settingsStores?: ICreateSettingsReporterOptions['settingsStores'];
}): {
  session: IProtocolSession;
  reporter: ReturnType<typeof createSettingsReporter>;
  // The exact object `createSettingsReporter` closed over — same reference `applyPatch`'s
  // `language` case swaps `.process` on, so a test can read it back after a call.
  commandHostAdapters: ICommandHostAdapters;
} {
  const session = createTestInteractiveSession({
    ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
    getStatusSnapshot: () => ({
      sessionId: 's',
      model: 'test-model',
      permissionMode: (options.permissionMode ?? 'default') as never,
      effort: 'auto',
      context: { usedTokens: 0, maxTokens: 1, usedPercentage: 0, remainingPercentage: 100 },
      goal: null,
    }),
  });
  const commandHostAdapters: ICommandHostAdapters = {
    settings: fakeSettingsAdapter({ language: 'en' }),
    ...options.commandHostAdapters,
  };
  const reporter = createSettingsReporter({
    commandHostAdapters,
    settingsSources: options.settingsSources ?? [],
    settingsStores: options.settingsStores ?? [],
  });
  return { session, reporter, commandHostAdapters };
}

function listResult(data: Record<string, unknown>): ICommandResult {
  return { success: true, message: '', data };
}

describe('createSettingsReporter (#3282 §4a)', () => {
  it('builds a snapshot from the output-style/preset list commands and the status snapshot', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') {
        return listResult({
          outputStyles: [{ id: 'default', name: 'Default', description: 'Plain replies.' }],
          active: 'default',
        });
      }
      if (name === 'preset' && args === 'list') {
        return listResult({
          presets: [{ id: 'default', title: 'Default', description: 'Neutral baseline.' }],
          active: 'default',
        });
      }
      return null;
    });
    const { session, reporter } = setup({ executeCommand, permissionMode: 'acceptEdits' });

    const settings = await reporter.getSettings(session);

    expect(executeCommand).toHaveBeenCalledWith('output-style', 'list', 'remote');
    expect(executeCommand).toHaveBeenCalledWith('preset', 'list', 'remote');
    expect(settings.outputStyle).toEqual({
      current: 'default',
      choices: [{ id: 'default', label: 'Default', description: 'Plain replies.' }],
    });
    expect(settings.preset.current).toBe('default');
    expect(settings.preset.choices).toEqual([
      { id: 'default', label: 'Default', description: 'Neutral baseline.' },
    ]);
    expect(settings.language.current).toBe('en');
    expect(settings.permissionMode.current).toBe('acceptEdits');
    expect(settings.permissionMode.skipsAllChecksMode).toBe('bypassPermissions');
    // Plain labels, never the raw ids, per #3282's design.
    expect(settings.permissionMode.choices).toContainEqual(
      expect.objectContaining({ id: 'default', label: 'Ask first' }),
    );
    expect(settings.permissionMode.choices).toContainEqual(
      expect.objectContaining({ id: 'bypassPermissions', label: 'Skip all checks' }),
    );
  });

  it('flags no built-in preset today — none of them resolve to bypassPermissions', async () => {
    // Documents the current catalog rather than asserting a specific id: `autonomous-builder`'s
    // `autonomy: 'act-first'` maps to `acceptEdits`, not `bypassPermissions` (see
    // `AUTONOMY_TO_PERMISSION_MODE` in `agent-preset`). The GUI shows no preset-confirmation dialog
    // today; a host-supplied preset that DOES set `permissionMode: 'bypassPermissions'` would be
    // flagged the same way, since the check reads the resolved option directly.
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') {
        return listResult({
          presets: [
            { id: 'default', title: 'Default', description: 'd' },
            { id: 'autonomous-builder', title: 'Autonomous Builder', description: 'd' },
            { id: 'careful-reviewer', title: 'Careful Reviewer', description: 'd' },
            { id: 'neutral-executor', title: 'Neutral Executor', description: 'd' },
          ],
          active: 'default',
        });
      }
      return null;
    });
    const { session, reporter } = setup({ executeCommand });
    const settings = await reporter.getSettings(session);
    expect(settings.preset.skipsAllChecksPresetIds).toEqual([]);
  });

  it('applies an output-style patch by calling the same command /output-style runs', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'concise') return { success: true, message: 'ok' };
      if (name === 'output-style' && args === 'list') {
        return listResult({ outputStyles: [], active: 'concise' });
      }
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    const outcome = await reporter.updateSettings(session, {
      field: 'outputStyle',
      styleId: 'concise',
    });

    expect(executeCommand).toHaveBeenCalledWith('output-style', 'concise', 'remote');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.settings.outputStyle.current).toBe('concise');
  });

  it('reports the command result message as the refusal when a patch fails, applying nothing', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'preset' && args === 'nope') {
        return { success: false, message: 'Unknown preset: nope. Available: default' };
      }
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    const outcome = await reporter.updateSettings(session, { field: 'preset', presetId: 'nope' });

    expect(outcome).toEqual({
      ok: false,
      code: 'invalid',
      message: 'Unknown preset: nope. Available: default',
    });
  });

  it('reports a guarded permission mode as refused, matching what /mode would refuse', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'mode' && args === 'bypassPermissions') {
        return { success: false, message: 'This workspace blocks bypassing every check.' };
      }
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    const outcome = await reporter.updateSettings(session, {
      field: 'permissionMode',
      mode: 'bypassPermissions',
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'refused',
      message: 'This workspace blocks bypassing every check.',
    });
  });

  it('routes language through the same /language command path, so an optional remoteCommandPolicy sees it too', async () => {
    const settings = fakeSettingsAdapter({ language: 'en', outputStyle: 'default' });
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'language') {
        // Mirrors `/language`'s real host action closely enough for this test: it writes the same
        // settings document and requests a restart. The reporter must reach this exact path (proof
        // it isn't bypassed) while the restart it triggers must never fire (proof it's suppressed).
        settings.write({ ...settings.read(), language: args });
        commandHostAdapters.process?.requestRestart('other', 'Language change restart');
        return { success: true, message: `Language set to "${args}".` };
      }
      return null;
    });
    const requestRestart = vi.fn();
    const { session, reporter, commandHostAdapters } = setup({
      executeCommand,
      commandHostAdapters: { settings, process: { requestExit: vi.fn(), requestRestart } },
    });

    const outcome = await reporter.updateSettings(session, { field: 'language', language: 'ko' });

    expect(executeCommand).toHaveBeenCalledWith('language', 'ko', 'remote');
    expect(settings.read()).toEqual({ language: 'ko', outputStyle: 'default' });
    // The real adapter's `requestRestart` was swapped out for the duration of the call, so the
    // restart `/language`'s host action always requests never reached it.
    expect(requestRestart).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.settings.language.current).toBe('ko');
  });

  it('restores the real process adapter afterward, so a later genuine restart still works', async () => {
    const settings = fakeSettingsAdapter({ language: 'en' });
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'language') return { success: true, message: 'ok' };
      return null;
    });
    const requestRestart = vi.fn();
    const realProcess = { requestExit: vi.fn(), requestRestart };
    const { session, reporter, commandHostAdapters } = setup({
      executeCommand,
      commandHostAdapters: { settings, process: realProcess },
    });

    await reporter.updateSettings(session, { field: 'language', language: 'ko' });

    expect(commandHostAdapters.process).toBe(realProcess);
    commandHostAdapters.process?.requestRestart('other', 'unrelated restart');
    expect(requestRestart).toHaveBeenCalledExactlyOnceWith('other', 'unrelated restart');
  });

  it('reports the command result message as the refusal when /language fails, writing nothing', async () => {
    const settings = fakeSettingsAdapter({ language: 'en' });
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'language') {
        return { success: false, message: "command 'language' is not permitted by the configured remote-command policy" };
      }
      return null;
    });
    const { session, reporter } = setup({
      executeCommand,
      commandHostAdapters: { settings, process: { requestExit: vi.fn(), requestRestart: vi.fn() } },
    });

    const outcome = await reporter.updateSettings(session, { field: 'language', language: 'ko' });

    expect(outcome).toEqual({
      ok: false,
      code: 'invalid',
      message: "command 'language' is not permitted by the configured remote-command policy",
    });
    expect(settings.read()).toEqual({ language: 'en' });
  });

  it('with no process adapter, falls back to writing the settings document directly', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const settings = fakeSettingsAdapter({ language: 'en', outputStyle: 'default' });
    const { session, reporter } = setup({
      executeCommand,
      commandHostAdapters: { settings },
    });

    const outcome = await reporter.updateSettings(session, { field: 'language', language: 'ko' });

    expect(executeCommand).not.toHaveBeenCalledWith('language', expect.anything(), 'remote');
    expect(settings.read()).toEqual({ language: 'ko', outputStyle: 'default' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.settings.language.current).toBe('ko');
  });

  it('removes a permission rule through the adapter and leaves other rules and files untouched', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const userStore = fakeStore('user', {
      permissions: { allow: ['Bash(git push:*)'], deny: ['Bash(rm -rf *)'] },
    });
    const { session, reporter } = setup({
      executeCommand,
      commandHostAdapters: {
        permissionRules: {
          readLayers: () => [
            {
              source: 'user.json',
              scope: 'user',
              allow: ['Bash(git push:*)'],
              deny: ['Bash(rm -rf *)'],
              ask: [],
            },
          ],
          removeRule: (removal) => {
            const data = userStore.read() as {
              permissions: { allow: string[]; deny: string[]; ask: string[] };
            };
            const kind = removal.kind;
            const list = data.permissions[kind];
            if (!list.includes(removal.pattern)) return false;
            userStore.write({
              ...data,
              permissions: { ...data.permissions, [kind]: list.filter((p) => p !== removal.pattern) },
            });
            return true;
          },
        },
      },
      settingsStores: [userStore],
    });

    const outcome = await reporter.updateSettings(session, {
      field: 'removePermissionRule',
      scope: 'user',
      kind: 'allow',
      pattern: 'Bash(git push:*)',
    });

    expect(outcome.ok).toBe(true);
    expect(userStore.read()).toEqual({
      permissions: { allow: [], deny: ['Bash(rm -rf *)'] },
    });
  });

  it('answers not_available for a rule removal when the host cannot rewrite rules', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    const outcome = await reporter.updateSettings(session, {
      field: 'removePermissionRule',
      scope: 'user',
      kind: 'allow',
      pattern: 'Bash(git push:*)',
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'not_available',
      message: 'Permission rules cannot be edited on this host.',
    });
  });

  it('maps the sandbox switch to auto-allow / off through the same /sandbox command', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'sandbox') return { success: true, message: 'ok' };
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    await reporter.updateSettings(session, { field: 'sandbox', enabled: true });
    expect(executeCommand).toHaveBeenCalledWith('sandbox', 'auto-allow', 'remote');

    await reporter.updateSettings(session, { field: 'sandbox', enabled: false });
    expect(executeCommand).toHaveBeenCalledWith('sandbox', 'off', 'remote');
  });

  it('builds the MCP and plugins sections from /mcp status and /plugin list (#3282 §4 part b-2)', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'mcp' && args === 'status') {
        return listResult({
          servers: [
            {
              serverId: 'docs',
              displayName: 'docs',
              source: 'project',
              status: 'approved',
              allowed: true,
              connection: 'connected',
              toolNames: ['search_docs'],
            },
            {
              serverId: 'flaky',
              source: 'user',
              status: 'approved',
              allowed: true,
              connection: 'failed',
              connectionFailureReason: 'stdio connection failed',
              toolNames: [],
            },
          ],
        });
      }
      if (name === 'plugin' && args === 'list') {
        return listResult({
          plugins: [{ name: 'formatter@robota', description: 'Formats code.', enabled: true }],
        });
      }
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    const settings = await reporter.getSettings(session);

    expect(settings.mcp.servers).toEqual([
      {
        id: 'docs',
        name: 'docs',
        scopeLabel: 'This project',
        status: 'connected',
        toolNames: ['search_docs'],
        enabled: true,
      },
      {
        id: 'flaky',
        name: 'flaky',
        scopeLabel: 'All projects',
        status: 'failed',
        statusReason: 'stdio connection failed',
        toolNames: [],
        enabled: true,
      },
    ]);
    expect(settings.plugins.plugins).toEqual([
      { id: 'formatter@robota', name: 'formatter@robota', description: 'Formats code.', enabled: true },
    ]);
  });

  it('canInstall is true on a local read and false on a remote one', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    expect((await reporter.getSettings(session)).plugins.canInstall).toBe(true);
    expect((await reporter.getSettings(session, 'local')).plugins.canInstall).toBe(true);
    expect((await reporter.getSettings(session, 'remote')).plugins.canInstall).toBe(false);
  });

  it('mcpServerEnabled toggles through the same /mcp approve|reject command', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'mcp' && (args === 'approve docs' || args === 'reject docs')) {
        return { success: true, message: 'ok' };
      }
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    await reporter.updateSettings(session, { field: 'mcpServerEnabled', serverId: 'docs', enabled: true });
    expect(executeCommand).toHaveBeenCalledWith('mcp', 'approve docs', 'remote');

    await reporter.updateSettings(session, { field: 'mcpServerEnabled', serverId: 'docs', enabled: false });
    expect(executeCommand).toHaveBeenCalledWith('mcp', 'reject docs', 'remote');
  });

  it('reloadMcpServers and reloadPlugins call the same reload commands', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'mcp' && args === 'reload') return { success: true, message: 'ok' };
      if (name === 'reload-plugins') return { success: true, message: 'ok' };
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    await reporter.updateSettings(session, { field: 'reloadMcpServers' });
    expect(executeCommand).toHaveBeenCalledWith('mcp', 'reload', 'remote');

    await reporter.updateSettings(session, { field: 'reloadPlugins' });
    expect(executeCommand).toHaveBeenCalledWith('reload-plugins', '', 'remote');
  });

  it('pluginEnabled toggles through the same /plugin enable|disable command', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      if (name === 'plugin' && (args === 'enable demo@robota' || args === 'disable demo@robota')) {
        return { success: true, message: 'ok' };
      }
      return null;
    });
    const { session, reporter } = setup({ executeCommand });

    await reporter.updateSettings(session, {
      field: 'pluginEnabled',
      pluginId: 'demo@robota',
      enabled: false,
    });
    expect(executeCommand).toHaveBeenCalledWith('plugin', 'disable demo@robota', 'remote');
  });

  describe('installPlugin/uninstallPlugin forward this connection\'s locality to /plugin, the same rule the command uses (#3282 §4 part b-2)', () => {
    it('a local install reaches the plugin command and succeeds', async () => {
      const executeCommand = vi.fn(async (name: string, args: string) => {
        if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
        if (name === 'preset' && args === 'list') return listResult({ presets: [] });
        if (name === 'plugin' && args === 'install demo@robota') {
          return { success: true, message: 'Installed plugin: demo@robota' };
        }
        return null;
      });
      const { session, reporter } = setup({ executeCommand });

      const outcome = await reporter.updateSettings(
        session,
        { field: 'installPlugin', pluginId: 'demo@robota' },
        'local',
      );

      expect(executeCommand).toHaveBeenCalledWith(
        'plugin',
        'install demo@robota',
        'remote',
        undefined,
        'local',
      );
      expect(outcome.ok).toBe(true);
    });

    it('a remote install is refused, carrying the command\'s own plain message', async () => {
      const executeCommand = vi.fn(async (name: string, args: string) => {
        if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
        if (name === 'preset' && args === 'list') return listResult({ presets: [] });
        if (name === 'plugin' && args === 'install demo@robota') {
          return {
            success: false,
            message:
              'Installing and uninstalling plugins runs code on this computer, so it only works ' +
              'from the desktop app or the page opened here — not from a remote device.',
          };
        }
        return null;
      });
      const { session, reporter } = setup({ executeCommand });

      const outcome = await reporter.updateSettings(
        session,
        { field: 'installPlugin', pluginId: 'demo@robota' },
        'remote',
      );

      expect(executeCommand).toHaveBeenCalledWith(
        'plugin',
        'install demo@robota',
        'remote',
        undefined,
        'remote',
      );
      expect(outcome).toEqual({
        ok: false,
        code: 'refused',
        message:
          'Installing and uninstalling plugins runs code on this computer, so it only works ' +
          'from the desktop app or the page opened here — not from a remote device.',
      });
    });

    it('a remote uninstall is refused the same way', async () => {
      const executeCommand = vi.fn(async (name: string, args: string) => {
        if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
        if (name === 'preset' && args === 'list') return listResult({ presets: [] });
        if (name === 'plugin' && args === 'uninstall demo@robota') {
          return { success: false, message: 'not from a remote device.' };
        }
        return null;
      });
      const { session, reporter } = setup({ executeCommand });

      const outcome = await reporter.updateSettings(
        session,
        { field: 'uninstallPlugin', pluginId: 'demo@robota' },
        'remote',
      );

      expect(executeCommand).toHaveBeenCalledWith(
        'plugin',
        'uninstall demo@robota',
        'remote',
        undefined,
        'remote',
      );
      expect(outcome.ok).toBe(false);
    });
  });

  it('describes "regular" mode accurately: confined but still prompting, not "without a prompt"', async () => {
    const executeCommand = vi.fn(async (name: string, args: string) => {
      if (name === 'output-style' && args === 'list') return listResult({ outputStyles: [] });
      if (name === 'preset' && args === 'list') return listResult({ presets: [] });
      return null;
    });
    const { session, reporter } = setup({
      executeCommand,
      commandHostAdapters: {
        sandbox: {
          status: () => ({ mode: 'regular', network: true, excludedCommands: [] }),
          setMode: vi.fn(),
        },
      },
    });

    const settings = await reporter.getSettings(session);

    // "regular" still confines commands (not `off`), so the switch reads as on, but it still asks
    // before each command — the opposite of what the switch's own "auto-allow" target mode does.
    expect(settings.sandbox.enabled).toBe(true);
    expect(settings.sandbox.description).not.toMatch(/without a prompt/);
    expect(settings.sandbox.description).toMatch(/prompts still appear/);
  });
});
