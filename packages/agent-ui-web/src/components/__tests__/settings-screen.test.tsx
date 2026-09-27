// @vitest-environment jsdom
/**
 * #3282 §4a — the Settings screen: current values marked, a change sends a typed update and the
 * control reflects the new snapshot, a failed update reverts with a plain message, Esc closes with
 * focus restored, and the two confirmations ("Skip all checks", removing a rule).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsScreen } from '../SettingsScreen.js';

import type { IWsSessionState } from '../../hooks/session-client-types.js';
import type { ISettingsSnapshot } from '@robota-sdk/agent-interface-session';

afterEach(cleanup);

const snapshot: ISettingsSnapshot = {
  language: {
    current: 'en',
    recommended: [
      { id: 'ko', label: 'Korean', description: 'ko' },
      { id: 'en', label: 'English', description: 'en' },
    ],
    appliesNote: 'Takes effect the next time Robota starts.',
  },
  outputStyle: {
    current: 'default',
    choices: [
      { id: 'default', label: 'Default', description: 'Plain replies.' },
      { id: 'concise', label: 'Concise', description: 'Shorter replies.' },
    ],
  },
  preset: {
    current: 'default',
    choices: [{ id: 'default', label: 'Default', description: 'Neutral baseline.' }],
    skipsAllChecksPresetIds: [],
  },
  permissionMode: {
    current: 'default',
    choices: [
      { id: 'default', label: 'Ask first', description: 'Ask before risky actions' },
      { id: 'bypassPermissions', label: 'Skip all checks', description: 'Skip all permission checks' },
    ],
    skipsAllChecksMode: 'bypassPermissions',
  },
  permissionRules: [
    {
      id: 'user:allow:Bash(git push:*)',
      scope: 'user',
      source: '~/.robota/settings.json',
      kind: 'allow',
      pattern: 'Bash(git push:*)',
      removable: true,
    },
  ],
  sandbox: { enabled: true, available: true, description: 'Confines shell commands.' },
  mcp: {
    servers: [
      {
        id: 'docs',
        name: 'docs',
        scopeLabel: 'This project',
        status: 'connected',
        toolNames: ['search_docs', 'read_doc'],
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
    ],
  },
  plugins: {
    plugins: [
      { id: 'formatter@robota', name: 'formatter@robota', description: 'Formats code.', enabled: true },
    ],
    canInstall: true,
  },
  providers: {
    profiles: [
      {
        name: 'anthropic',
        providerLabel: 'Anthropic',
        model: { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        current: true,
      },
      {
        name: 'backup',
        providerLabel: 'Anthropic',
        model: { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
        current: false,
        connectionState: 'Key missing',
      },
    ],
  },
};

function buildState(overrides: Partial<IWsSessionState> = {}): IWsSessionState {
  return {
    settingsOpen: true,
    settingsStatus: 'ready',
    settingsSnapshot: snapshot,
    settingsError: null,
    settingsInitialSectionId: null,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    updateSettings: vi.fn(),
    send: vi.fn(),
    modelList: null,
    requestModelList: vi.fn(),
    ...overrides,
  } as unknown as IWsSessionState;
}

function openPermissions(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
}

function openMcp(): void {
  fireEvent.click(screen.getByRole('button', { name: 'MCP Servers' }));
}

function openPlugins(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
}

function openProviders(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Providers & Models' }));
}

describe('SettingsScreen — presentation', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SettingsScreen state={buildState({ settingsOpen: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the current value of each General control', () => {
    render(<SettingsScreen state={buildState()} />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('en');
    expect((screen.getByLabelText('Output style') as HTMLSelectElement).value).toBe('default');
    expect((screen.getByLabelText('Preset') as HTMLSelectElement).value).toBe('default');
  });

  it('marks the active section', () => {
    render(<SettingsScreen state={buildState()} />);
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe(
      'true',
    );
    openPermissions();
    expect(screen.getByRole('button', { name: 'Permissions' }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('shows the current value of the permission mode and sandbox controls', () => {
    render(<SettingsScreen state={buildState()} />);
    openPermissions();
    expect(
      (screen.getByLabelText('Default permission mode') as HTMLSelectElement).value,
    ).toBe('default');
    expect(screen.getByRole('switch', { name: 'Sandbox' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('a host with no snapshot yet shows a loading state, not an empty screen', () => {
    render(
      <SettingsScreen
        state={buildState({ settingsSnapshot: null, settingsStatus: 'loading' })}
      />,
    );
    expect(screen.getByText(/loading settings/i)).toBeTruthy();
  });

  it('a failed initial load offers Try again, which re-fetches', () => {
    const openSettings = vi.fn();
    render(
      <SettingsScreen
        state={buildState({
          settingsSnapshot: null,
          settingsStatus: 'error',
          settingsError: 'Settings are not available on this host.',
          openSettings,
        })}
      />,
    );
    expect(screen.getByText('Settings are not available on this host.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(openSettings).toHaveBeenCalledOnce();
  });
});

describe('SettingsScreen — a change sends a typed update, never command text', () => {
  it('changing the output style calls updateSettings with a discriminated patch', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    fireEvent.change(screen.getByLabelText('Output style'), { target: { value: 'concise' } });
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'outputStyle',
      styleId: 'concise',
    });
  });

  it('the control reflects the new snapshot once the update completes', () => {
    const { rerender } = render(<SettingsScreen state={buildState()} />);
    const updated: ISettingsSnapshot = {
      ...snapshot,
      outputStyle: { ...snapshot.outputStyle, current: 'concise' },
    };
    rerender(<SettingsScreen state={buildState({ settingsSnapshot: updated })} />);
    expect((screen.getByLabelText('Output style') as HTMLSelectElement).value).toBe('concise');
  });

  it('a failed update leaves the control at its previous value and shows a plain message', () => {
    const { rerender } = render(<SettingsScreen state={buildState()} />);
    fireEvent.change(screen.getByLabelText('Output style'), { target: { value: 'concise' } });
    // The snapshot the reducer holds never changed — a refusal answers with `settings_error`, not
    // a fresh `settings` snapshot — so the control keeps showing the value it had before the write.
    rerender(
      <SettingsScreen
        state={buildState({ settingsError: 'Unknown output style "concise".' })}
      />,
    );
    expect((screen.getByLabelText('Output style') as HTMLSelectElement).value).toBe('default');
    expect(screen.getByText('Unknown output style "concise".')).toBeTruthy();
  });

  it('typing a language and leaving the field sends the free-text patch', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: '__other__' } });
    const field = screen.getByLabelText('Language — other');
    fireEvent.change(field, { target: { value: 'fr' } });
    fireEvent.blur(field);
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ field: 'language', language: 'fr' });
  });
});

describe('SettingsScreen — Esc closes and returns focus to the opener', () => {
  function Harness(): React.ReactElement {
    const [open, setOpen] = useState(false);
    const state = buildState({ settingsOpen: open, closeSettings: () => setOpen(false) });
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
        <SettingsScreen state={state} />
      </>
    );
  }

  it('Esc closes the dialog and focus returns to the button that opened it', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('the Close button closes it too', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('Esc while a nested ConfirmDialog is open cancels only the confirm dialog, not the Settings screen', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    openPermissions();
    fireEvent.click(screen.getByRole('button', { name: /Remove rule/ }));
    expect(screen.getByRole('alertdialog', { name: 'Remove this rule?' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog', { name: 'Remove this rule?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });
});

describe('SettingsScreen — "Skip all checks" needs confirmation', () => {
  it('choosing it as the default mode asks first and sends nothing until confirmed', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openPermissions();
    fireEvent.change(screen.getByLabelText('Default permission mode'), {
      target: { value: 'bypassPermissions' },
    });
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Skip all permission checks?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip all checks' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'permissionMode',
      mode: 'bypassPermissions',
    });
  });

  it('cancelling sends nothing', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openPermissions();
    fireEvent.change(screen.getByLabelText('Default permission mode'), {
      target: { value: 'bypassPermissions' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Skip all permission checks?' })).toBeNull();
  });

  it('a preset that would set the same mode is confirmed the same way', () => {
    const state = buildState({
      settingsSnapshot: {
        ...snapshot,
        preset: {
          current: 'default',
          choices: [
            { id: 'default', label: 'Default', description: 'd' },
            { id: 'yolo', label: 'Yolo', description: 'd' },
          ],
          skipsAllChecksPresetIds: ['yolo'],
        },
      },
    });
    render(<SettingsScreen state={state} />);
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'yolo' } });
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Skip all permission checks?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip all checks' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ field: 'preset', presetId: 'yolo' });
  });
});

describe('SettingsScreen — removing a permission rule needs confirmation', () => {
  it('asks first, sends the removal only once confirmed', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openPermissions();
    fireEvent.click(screen.getByRole('button', { name: /Remove rule/ }));
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Remove this rule?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'removePermissionRule',
      scope: 'user',
      kind: 'allow',
      pattern: 'Bash(git push:*)',
    });
  });

  it('a rule the host cannot rewrite offers no Remove button', () => {
    const state = buildState({
      settingsSnapshot: {
        ...snapshot,
        permissionRules: [{ ...snapshot.permissionRules[0]!, removable: false }],
      },
    });
    render(<SettingsScreen state={state} />);
    openPermissions();
    expect(screen.queryByRole('button', { name: /Remove rule/ })).toBeNull();
  });
});

describe('SettingsScreen — MCP Servers section (#3282 §4 part b-2)', () => {
  it('lists every server with plain labels: name, scope, status and tool count', () => {
    render(<SettingsScreen state={buildState()} />);
    openMcp();
    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText(/This project/)).toBeTruthy();
    expect(screen.getByText(/Connected/)).toBeTruthy();
    expect(screen.getByText(/2 tools/)).toBeTruthy();
    expect(screen.getByText('flaky')).toBeTruthy();
    expect(screen.getByText(/All projects/)).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText(/stdio connection failed/)).toBeTruthy();
  });

  it('the switch sends a typed mcpServerEnabled update', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openMcp();
    fireEvent.click(screen.getByRole('switch', { name: 'docs' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'mcpServerEnabled',
      serverId: 'docs',
      enabled: false,
    });
  });

  it('a failed toggle leaves the switch at its previous state and shows a plain message', () => {
    const { rerender } = render(<SettingsScreen state={buildState()} />);
    openMcp();
    fireEvent.click(screen.getByRole('switch', { name: 'docs' }));
    rerender(
      <SettingsScreen state={buildState({ settingsError: 'Could not change that MCP server.' })} />,
    );
    expect(screen.getByRole('switch', { name: 'docs' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Could not change that MCP server.')).toBeTruthy();
  });

  it('expanding a server shows its tool names', () => {
    render(<SettingsScreen state={buildState()} />);
    openMcp();
    fireEvent.click(screen.getByText('docs'));
    expect(screen.getByText('search_docs')).toBeTruthy();
    expect(screen.getByText('read_doc')).toBeTruthy();
  });

  it('Reload servers sends reloadMcpServers', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openMcp();
    fireEvent.click(screen.getByRole('button', { name: /Reload servers/ }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ field: 'reloadMcpServers' });
  });

  it('no servers configured shows a plain empty state', () => {
    render(
      <SettingsScreen
        state={buildState({ settingsSnapshot: { ...snapshot, mcp: { servers: [] } } })}
      />,
    );
    openMcp();
    expect(screen.getByText('No MCP servers are configured.')).toBeTruthy();
  });

  it('a failed reload stops the spinner too, not only a fresh snapshot (PR review)', () => {
    const { rerender } = render(<SettingsScreen state={buildState()} />);
    openMcp();
    fireEvent.click(screen.getByRole('button', { name: /Reload servers/ }));
    expect(screen.getByRole('button', { name: /Reload servers/ }).hasAttribute('disabled')).toBe(
      true,
    );

    // The reload's reply is a settingsError, not a new snapshot — the spinner must still clear.
    rerender(
      <SettingsScreen
        state={buildState({ settingsError: 'MCP servers could not be reloaded.' })}
      />,
    );

    expect(screen.getByRole('button', { name: /Reload servers/ }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});

describe('SettingsScreen — Plugins section (#3282 §4 part b-2)', () => {
  it('lists every plugin with plain labels: name, description and enabled state', () => {
    render(<SettingsScreen state={buildState()} />);
    openPlugins();
    expect(screen.getByText('formatter@robota')).toBeTruthy();
    expect(screen.getByText('Formats code.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'formatter@robota' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('the switch sends a typed pluginEnabled update', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openPlugins();
    fireEvent.click(screen.getByRole('switch', { name: 'formatter@robota' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'pluginEnabled',
      pluginId: 'formatter@robota',
      enabled: false,
    });
  });

  it('a failed toggle leaves the switch at its previous state and shows a plain message', () => {
    const { rerender } = render(<SettingsScreen state={buildState()} />);
    openPlugins();
    fireEvent.click(screen.getByRole('switch', { name: 'formatter@robota' }));
    rerender(<SettingsScreen state={buildState({ settingsError: 'Could not change that plugin.' })} />);
    expect(
      screen.getByRole('switch', { name: 'formatter@robota' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByText('Could not change that plugin.')).toBeTruthy();
  });

  it('Reload plugins sends reloadPlugins', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openPlugins();
    fireEvent.click(screen.getByRole('button', { name: /Reload plugins/ }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ field: 'reloadPlugins' });
  });

  it('no plugins installed shows a plain empty state', () => {
    render(
      <SettingsScreen
        state={buildState({
          settingsSnapshot: { ...snapshot, plugins: { plugins: [], canInstall: true } },
        })}
      />,
    );
    openPlugins();
    expect(screen.getByText('No plugins are installed.')).toBeTruthy();
  });

  it('opens straight to Plugins when settingsInitialSectionId is "plugins" (the /plugin path)', () => {
    render(<SettingsScreen state={buildState({ settingsInitialSectionId: 'plugins' })} />);
    expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('formatter@robota')).toBeTruthy();
  });

  describe('installing a plugin needs confirmation and names the plugin and its source', () => {
    it('asks first, sends nothing until confirmed', () => {
      const state = buildState();
      render(<SettingsScreen state={state} />);
      openPlugins();
      fireEvent.change(screen.getByLabelText('Install a plugin'), {
        target: { value: 'linter@robota' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
      expect(state.updateSettings).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog', { name: 'Install this plugin?' })).toBeTruthy();
      expect(screen.getByText(/"linter"/)).toBeTruthy();
      expect(screen.getByText(/from robota/)).toBeTruthy();
      expect(screen.getByText(/It can run code on this computer\./)).toBeTruthy();
      fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[1]!);
      expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
        field: 'installPlugin',
        pluginId: 'linter@robota',
      });
    });

    it('cancelling sends nothing', () => {
      const state = buildState();
      render(<SettingsScreen state={state} />);
      openPlugins();
      fireEvent.change(screen.getByLabelText('Install a plugin'), {
        target: { value: 'linter@robota' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(state.updateSettings).not.toHaveBeenCalled();
    });
  });

  it('uninstalling asks first and is destructive', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openPlugins();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall formatter@robota' }));
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Uninstall this plugin?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'uninstallPlugin',
      pluginId: 'formatter@robota',
    });
  });

  it('on a remote surface (canInstall false) there is no install field and no uninstall button', () => {
    const state = buildState({
      settingsSnapshot: {
        ...snapshot,
        plugins: { plugins: snapshot.plugins.plugins, canInstall: false },
      },
    });
    render(<SettingsScreen state={state} />);
    openPlugins();
    expect(screen.queryByLabelText('Install a plugin')).toBeNull();
    expect(screen.queryByRole('button', { name: /Uninstall/ })).toBeNull();
    expect(screen.getByText(/not from a remote device/)).toBeTruthy();
  });
});

describe('SettingsScreen — Providers & Models section (#3282 §4b)', () => {
  it('lists every configured profile with its provider name, model label and a checkmark on the one in use', () => {
    render(<SettingsScreen state={buildState()} />);
    openProviders();

    expect(screen.getByText('anthropic')).toBeTruthy();
    expect(screen.getByText('backup')).toBeTruthy();
    expect(screen.getByText(/Claude Sonnet 4\.6/)).toBeTruthy();
    expect(screen.getByText(/Claude Haiku 4\.5/)).toBeTruthy();
    // Only the current profile is marked — the sr-only "(in use)" suffix on its name.
    expect(screen.getByText('(in use)')).toBeTruthy();
    expect(screen.getByText('Key missing')).toBeTruthy();
  });

  it('opens directly on this section when settingsInitialSectionId is "providers" (Manage providers…)', () => {
    render(<SettingsScreen state={buildState({ settingsInitialSectionId: 'providers' })} />);
    expect(screen.getByRole('button', { name: 'Providers & Models' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByText('anthropic')).toBeTruthy();
  });

  it('"Use" sends a providerProfile patch for an inactive profile and is disabled for the current one', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openProviders();

    const useButtons = screen.getAllByRole('button', { name: 'Use' });
    // anthropic is current (disabled), backup is not.
    expect(useButtons[0]!.hasAttribute('disabled')).toBe(true);
    expect(useButtons[1]!.hasAttribute('disabled')).toBe(false);

    fireEvent.click(useButtons[1]!);
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'providerProfile',
      profileName: 'backup',
    });
  });

  it('"Model" opens a pop-up of that profile\'s catalog models and sends a providerModel patch', () => {
    const state = buildState({
      modelList: {
        groups: [
          {
            profileName: 'backup',
            providerLabel: 'Anthropic',
            models: [
              { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
              { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
            ],
          },
        ],
        currentProfile: 'anthropic',
        currentModel: 'claude-sonnet-4-6',
      },
    });
    render(<SettingsScreen state={state} />);
    openProviders();

    fireEvent.click(screen.getAllByRole('button', { name: 'Model' })[1]!);
    const menu = screen.getByRole('menu', { name: 'Models for backup' });
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Claude Opus 4.5' }));

    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'providerModel',
      profileName: 'backup',
      modelId: 'claude-opus-4-5',
    });
  });

  it('requests the model list once this section is shown', () => {
    const requestModelList = vi.fn();
    render(<SettingsScreen state={buildState({ requestModelList })} />);
    openProviders();
    expect(requestModelList).toHaveBeenCalled();
  });

  it('Edit…, Test connection and Duplicate… dispatch the same /provider command paths the profile flow uses', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openProviders();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit…' })[0]!);
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'provider', args: 'edit anthropic' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Test connection' })[0]!);
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'provider', args: 'test anthropic' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate…' })[0]!);
    expect(state.send).toHaveBeenCalledWith({
      type: 'command',
      name: 'provider',
      args: 'duplicate anthropic',
    });
  });

  it('"Delete…" is destructive, confirmed, and sends a deleteProviderProfile patch only once confirmed', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openProviders();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete…' })[1]!); // backup
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Delete profile "backup"?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      field: 'deleteProviderProfile',
      profileName: 'backup',
    });
  });

  it('cancelling the delete confirmation sends nothing', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openProviders();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete…' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.updateSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Delete profile "backup"?' })).toBeNull();
  });

  it('"Add provider…" runs the same /provider add flow the first-run setup panel uses', () => {
    const state = buildState();
    render(<SettingsScreen state={state} />);
    openProviders();

    fireEvent.click(screen.getByRole('button', { name: 'Add provider…' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'provider', args: 'add' });
  });
});
