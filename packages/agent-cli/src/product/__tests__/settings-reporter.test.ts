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
}): { session: IProtocolSession; reporter: ReturnType<typeof createSettingsReporter> } {
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
  return { session, reporter };
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

  it('writes language directly to the settings document, never calling executeCommand for it', async () => {
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
});
