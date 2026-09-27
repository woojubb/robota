// @vitest-environment jsdom
/**
 * #3282 §4a — the Settings screen: current values marked, a change sends a typed update and the
 * control reflects the new snapshot, a failed update reverts with a plain message, Esc closes with
 * focus restored, and the two confirmations ("Skip all checks", removing a rule).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
};

function buildState(overrides: Partial<IWsSessionState> = {}): IWsSessionState {
  return {
    settingsOpen: true,
    settingsStatus: 'ready',
    settingsSnapshot: snapshot,
    settingsError: null,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    updateSettings: vi.fn(),
    ...overrides,
  } as unknown as IWsSessionState;
}

function openPermissions(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
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
    expect(screen.getByRole('dialog', { name: 'Skip all permission checks?' })).toBeTruthy();
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
    expect(screen.queryByRole('dialog', { name: 'Skip all permission checks?' })).toBeNull();
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
    expect(screen.getByRole('dialog', { name: 'Skip all permission checks?' })).toBeTruthy();
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
    expect(screen.getByRole('dialog', { name: 'Remove this rule?' })).toBeTruthy();
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
