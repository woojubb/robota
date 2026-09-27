// @vitest-environment jsdom
/**
 * #3282 §4b — the GUI reducer's support for the "Providers & Models" Settings section:
 *
 * - `openSettings(section)` opens on the named section ('general' when omitted, unchanged from
 *   before this section existed) — "Manage providers…" is the one caller that names 'providers'.
 * - A successful `/provider` command run through the raw command path (Add, Edit, Duplicate — Use/
 *   Model/Delete already return a fresh snapshot from their own `update-settings` reply) refreshes
 *   the snapshot while Settings is open, without resetting which section is showing or re-opening it.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

afterEach(() => window.sessionStorage.clear());

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
  wire: TClientMessage[];
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const wire: TClientMessage[] = [];
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    return { connect: () => {}, disconnect: () => {}, send: (message) => wire.push(message) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return { result, wire, deliver: (msg) => act(() => onMessage?.(msg)) };
}

function lastGetSettingsRequestId(wire: TClientMessage[]): string {
  const requests = wire.filter((msg): msg is Extract<TClientMessage, { type: 'get-settings' }> =>
    msg.type === 'get-settings',
  );
  const last = requests[requests.length - 1];
  if (!last) throw new Error('no get-settings request was sent');
  return last.requestId;
}

describe('#3282 §4b — openSettings(section)', () => {
  it('opens on General when no section is named (unchanged default)', () => {
    const { result } = setup();
    act(() => result.current.openSettings());
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsSection).toBe('general');
  });

  it('opens directly on "providers" when named — "Manage providers…"\'s path', () => {
    const { result } = setup();
    act(() => result.current.openSettings('providers'));
    expect(result.current.settingsSection).toBe('providers');
  });

  it('a later plain openSettings() resets back to General, even after "providers"', () => {
    const { result } = setup();
    act(() => result.current.openSettings('providers'));
    act(() => result.current.closeSettings());
    act(() => result.current.openSettings());
    expect(result.current.settingsSection).toBe('general');
  });
});

describe('#3282 §4b — refreshing after a successful /provider command', () => {
  it('re-fetches the snapshot when Settings is open', () => {
    const { result, deliver, wire } = setup();
    act(() => result.current.openSettings('providers'));
    const openRequests = wire.filter((msg) => msg.type === 'get-settings').length;

    deliver({ type: 'command_result', name: 'provider', message: 'Provider anthropic added.', success: true });

    const requestsAfter = wire.filter((msg) => msg.type === 'get-settings').length;
    expect(requestsAfter).toBe(openRequests + 1);
  });

  it('never re-fetches when Settings is closed', () => {
    const { result, deliver, wire } = setup();
    expect(result.current.settingsOpen).toBe(false);

    deliver({ type: 'command_result', name: 'provider', message: 'Provider anthropic added.', success: true });

    expect(wire.some((msg) => msg.type === 'get-settings')).toBe(false);
  });

  it('never re-fetches for a failed /provider command', () => {
    const { result, deliver, wire } = setup();
    act(() => result.current.openSettings('providers'));
    const openRequests = wire.filter((msg) => msg.type === 'get-settings').length;

    deliver({ type: 'command_result', name: 'provider', message: 'Provider profile "x" was not found.', success: false });

    expect(wire.filter((msg) => msg.type === 'get-settings').length).toBe(openRequests);
  });

  it('never re-fetches for an unrelated command', () => {
    const { result, deliver, wire } = setup();
    act(() => result.current.openSettings('providers'));
    const openRequests = wire.filter((msg) => msg.type === 'get-settings').length;

    deliver({ type: 'command_result', name: 'mode', message: 'Permission mode set to: acceptEdits', success: true });

    expect(wire.filter((msg) => msg.type === 'get-settings').length).toBe(openRequests);
  });

  it('the refresh never resets which section is showing', () => {
    const { result, deliver, wire } = setup();
    act(() => result.current.openSettings('providers'));
    deliver({
      type: 'settings',
      requestId: lastGetSettingsRequestId(wire),
      settings: {} as never,
    });
    expect(result.current.settingsSection).toBe('providers');

    deliver({ type: 'command_result', name: 'provider', message: 'Provider anthropic added.', success: true });

    expect(result.current.settingsSection).toBe('providers');
    expect(result.current.settingsOpen).toBe(true);
  });
});
